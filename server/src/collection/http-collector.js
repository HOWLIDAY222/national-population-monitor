import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const responseHeaders = (headers) => {
  const allowed = ['content-type', 'content-length', 'etag', 'last-modified', 'date', 'cache-control']
  return Object.fromEntries(allowed.map((name) => [name, headers.get(name)]).filter(([, value]) => value !== null))
}

const contentHashOf = (buffer) => createHash('sha256').update(buffer).digest('hex')
const nextCheckAt = (finishedAt, intervalSeconds) => new Date(
  new Date(finishedAt).getTime() + intervalSeconds * 1000,
).toISOString()
const errorMessageWithCause = (error) => {
  const cause = error?.cause
  const detail = [cause?.code, cause?.message].filter(Boolean).join(' ')
  return detail && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message
}
const fetchSourceResponse = async ({ source, headers, signal }) => {
  const candidates = [source.url, ...(source.fallbackUrls ?? []), ...(source.request.fallbackUrls ?? [])]
  const attempts = []
  let lastError
  for (const [index, requestUrl] of candidates.entries()) {
    try {
      const response = await fetch(requestUrl, { headers, signal, redirect: 'follow' })
      if (response.ok || response.status === 304 || index === candidates.length - 1) {
        return { response, requestUrl, fallbackUsed: index > 0, attempts }
      }
      attempts.push({ requestUrl, outcome: `HTTP ${response.status}` })
      lastError = new Error(`Source returned HTTP ${response.status}`)
      lastError.httpStatus = response.status
    } catch (error) {
      attempts.push({ requestUrl, outcome: errorMessageWithCause(error) })
      lastError = error
    }
  }
  lastError.attempts = attempts
  throw lastError
}

export class HttpCollector {
  constructor({ repository, rawStorage, logger }) {
    this.repository = repository
    this.rawStorage = rawStorage
    this.logger = logger
  }

  async collect(source) {
    const startedAt = new Date().toISOString()
    const started = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('Source request timed out')), source.request.timeoutMs)
    const headers = {
      'user-agent': source.request.userAgent,
      accept: source.kind === 'html' ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' : '*/*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.5',
      ...source.request.headers,
    }
    if (source.etag) headers['if-none-match'] = source.etag
    if (source.lastModified) headers['if-modified-since'] = source.lastModified

    try {
      const { response, requestUrl, fallbackUsed, attempts } = await fetchSourceResponse({ source, headers, signal: controller.signal })
      const finishedAt = new Date().toISOString()
      const sourceStatus = fallbackUsed ? 'delayed' : 'healthy'
      const transportWarning = fallbackUsed ? `Primary endpoint unavailable; monitored through fallback ${requestUrl}` : null
      if (response.status === 304) {
        const check = await this.repository.recordSourceCheck({
          sourceId: source.id, startedAt, finishedAt, outcome: 'unchanged', httpStatus: 304,
          contentHash: source.lastContentHash, durationMs: Math.round(performance.now() - started), errorCode: null, errorMessage: null,
          metadata: { conditionalRequest: true, requestUrl, fallbackUsed, attempts },
        })
        await this.repository.updateSource(source.id, {
          status: sourceStatus, lastCheckedAt: finishedAt, lastSuccessAt: finishedAt, consecutiveFailures: 0, lastError: transportWarning,
          nextCheckAt: nextCheckAt(finishedAt, source.checkIntervalSeconds),
        })
        return { outcome: 'unchanged', check, snapshot: null, buffer: null }
      }
      if (!response.ok) {
        const error = new Error(`Source returned HTTP ${response.status}`)
        error.httpStatus = response.status
        throw error
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const contentHash = contentHashOf(buffer)
      const headersObject = responseHeaders(response.headers)
      const outcome = source.lastContentHash === contentHash ? 'unchanged' : 'changed'
      const check = await this.repository.recordSourceCheck({
        sourceId: source.id, startedAt, finishedAt, outcome, httpStatus: response.status,
        contentHash, durationMs: Math.round(performance.now() - started), errorCode: null, errorMessage: null,
        metadata: { finalUrl: response.url, requestUrl, fallbackUsed, attempts, byteSize: buffer.byteLength },
      })
      let snapshot = null
      if (outcome === 'changed') {
        const storageKey = await this.rawStorage.save({
          source, contentHash, buffer, collectedAt: finishedAt,
          metadata: { sourceUrl: source.url, finalUrl: response.url, collectedAt: finishedAt, responseHeaders: headersObject, checkId: check.id },
        })
        const saved = await this.repository.saveRawSnapshot({
          sourceId: source.id, checkId: check.id, contentHash, contentType: headersObject['content-type'] ?? null,
          byteSize: buffer.byteLength, storageKey, responseHeaders: headersObject,
          sourcePublishedAt: source.sourcePublishedAt, collectedAt: finishedAt,
        })
        snapshot = saved.snapshot
      }
      await this.repository.updateSource(source.id, {
        status: sourceStatus, etag: headersObject.etag ?? source.etag, lastModified: headersObject['last-modified'] ?? source.lastModified,
        lastContentHash: contentHash, lastCheckedAt: finishedAt, lastSuccessAt: finishedAt, consecutiveFailures: 0, lastError: transportWarning,
        nextCheckAt: nextCheckAt(finishedAt, source.checkIntervalSeconds),
      })
      await this.logger.info('source.check.completed', { sourceId: source.id, outcome, contentHash, byteSize: buffer.byteLength, requestUrl, fallbackUsed })
      return { outcome, check, snapshot, buffer }
    } catch (error) {
      const finishedAt = new Date().toISOString()
      const nextFailures = (source.consecutiveFailures ?? 0) + 1
      const errorMessage = errorMessageWithCause(error)
      await this.repository.recordSourceCheck({
        sourceId: source.id, startedAt, finishedAt, outcome: 'failed', httpStatus: error.httpStatus ?? null, contentHash: null,
        durationMs: Math.round(performance.now() - started), errorCode: error.cause?.code ?? error.name, errorMessage,
        metadata: { attempts: error.attempts ?? [] },
      })
      await this.repository.updateSource(source.id, {
        status: nextFailures >= 3 ? 'failed' : 'delayed', lastCheckedAt: finishedAt,
        nextCheckAt: nextCheckAt(finishedAt, source.checkIntervalSeconds),
        consecutiveFailures: nextFailures, lastError: errorMessage,
      })
      await this.logger.error('source.check.failed', { sourceId: source.id, error: { name: error.name, message: errorMessage, stack: error.stack } })
      if (errorMessage !== error.message) throw new Error(errorMessage, { cause: error })
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
