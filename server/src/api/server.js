import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const jsonReplacer = (_key, value) => typeof value === 'bigint' ? Number(value) : value

const writeJson = (response, status, payload, extraHeaders = {}) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders })
  response.end(JSON.stringify(payload, jsonReplacer))
}

const parseLimit = (url, fallback = 50, maximum = 200) => Math.min(maximum, Math.max(1, Number(url.searchParams.get('limit') ?? fallback)))

const readJsonBody = async (request, maximumBytes = 1024 * 1024) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maximumBytes) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const tokenMatches = (provided, configured) => {
  if (!provided || !configured) return false
  const left = Buffer.from(provided)
  const right = Buffer.from(configured)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createApiServer({ config, repository, publisher, eventBus, logger }) {
  const sseClients = new Set()
  const heartbeat = setInterval(() => {
    const message = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`
    for (const response of sseClients) response.write(message)
  }, config.sseHeartbeatMs)
  heartbeat.unref?.()

  const onRealtimeEvent = (event) => {
    const message = `id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event, jsonReplacer)}\n\n`
    for (const response of sseClients) response.write(message)
  }
  eventBus.on('event', onRealtimeEvent)

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
    const path = requestUrl.pathname
    const origin = request.headers.origin
    const cors = origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
      ? { 'access-control-allow-origin': origin, vary: 'Origin' }
      : {}
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-admin-token' })
      response.end()
      return
    }

    try {
      if (request.method === 'GET' && (path === '/api/health' || path === `${config.apiPrefix}/health`)) {
        writeJson(response, 200, { ok: true, service: 'population-platform-server', timestamp: new Date().toISOString(), status: await repository.getStatus() }, cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/snapshot`) {
        writeJson(response, 200, await repository.getSnapshot(), cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/status`) {
        writeJson(response, 200, await repository.getStatus(), cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/sources`) {
        writeJson(response, 200, { items: await repository.listSources() }, cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/events`) {
        writeJson(response, 200, { items: await repository.listEvents(parseLimit(requestUrl)) }, cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/discoveries`) {
        const filters = {
          sourceId: requestUrl.searchParams.get('sourceId') ?? undefined,
          regionCode: requestUrl.searchParams.get('regionCode') ?? undefined,
          status: requestUrl.searchParams.get('status') ?? undefined,
        }
        writeJson(response, 200, { items: await repository.listDiscoveries(parseLimit(requestUrl, 100), filters) }, cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/versions`) {
        writeJson(response, 200, { items: await repository.listVersions(parseLimit(requestUrl)) }, cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/validation/issues`) {
        writeJson(response, 200, { items: await repository.listValidationIssues(parseLimit(requestUrl, 100)) }, cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/review-runs`) {
        writeJson(response, 200, { items: await repository.listReviewRuns(parseLimit(requestUrl)) }, cors)
        return
      }
      const reviewRunMatch = path.match(new RegExp(`^${config.apiPrefix}/review-runs/([0-9a-f-]+)$`))
      if (request.method === 'GET' && reviewRunMatch) {
        const reviewRun = await repository.getReviewRun(reviewRunMatch[1])
        if (!reviewRun) writeJson(response, 404, { error: 'review_run_not_found' }, cors)
        else writeJson(response, 200, reviewRun, cors)
        return
      }
      const historyMatch = path.match(new RegExp(`^${config.apiPrefix}/indicators/([a-z0-9_]+)/history$`))
      if (request.method === 'GET' && historyMatch) {
        const regionCode = requestUrl.searchParams.get('regionCode') ?? 'CN'
        writeJson(response, 200, { items: await repository.getIndicatorHistory(historyMatch[1], regionCode) }, cors)
        return
      }
      const regionMatch = path.match(new RegExp(`^${config.apiPrefix}/regions/([A-Z0-9]+)$`))
      if (request.method === 'GET' && regionMatch) {
        const region = await repository.getRegion(regionMatch[1])
        if (!region) writeJson(response, 404, { error: 'region_not_found' }, cors)
        else writeJson(response, 200, region, cors)
        return
      }
      if (request.method === 'GET' && path === `${config.apiPrefix}/stream`) {
        response.writeHead(200, {
          ...cors,
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        response.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`)
        sseClients.add(response)
        request.on('close', () => sseClients.delete(response))
        return
      }

      if (request.method === 'POST' && path.startsWith(`${config.apiPrefix}/admin/`)) {
        if (!config.adminToken) {
          writeJson(response, 503, { error: 'admin_api_disabled', message: 'ADMIN_TOKEN is not configured' }, cors)
          return
        }
        if (!tokenMatches(request.headers['x-admin-token'], config.adminToken)) {
          writeJson(response, 401, { error: 'unauthorized' }, cors)
          return
        }
        const collectMatch = path.match(new RegExp(`^${config.apiPrefix}/admin/sources/([a-z0-9-]+)/collect$`))
        if (collectMatch) {
          const job = await repository.enqueueSource(collectMatch[1], { priority: 1 })
          writeJson(response, 202, { job }, cors)
          return
        }
        if (path === `${config.apiPrefix}/admin/versions/publish`) {
          const body = await readJsonBody(request)
          const result = await publisher.publishParserRun(body.parserRunId, { actor: body.actor ?? 'admin-api', approved: true })
          writeJson(response, 201, result, cors)
          return
        }
        const rollbackMatch = path.match(new RegExp(`^${config.apiPrefix}/admin/versions/([0-9a-f-]+)/rollback$`))
        if (rollbackMatch) {
          const body = await readJsonBody(request)
          const result = await publisher.rollback(rollbackMatch[1], body.actor ?? 'admin-api')
          writeJson(response, 200, result, cors)
          return
        }
      }

      writeJson(response, 404, { error: 'not_found' }, cors)
    } catch (error) {
      await logger.error('api.request.failed', { method: request.method, path, error })
      writeJson(response, error instanceof SyntaxError ? 400 : 500, { error: 'request_failed', message: error.message }, cors)
    }
  })

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, () => {
        server.off('error', reject)
        resolve(server.address())
      })
    }),
    close: () => new Promise((resolve, reject) => {
      clearInterval(heartbeat)
      eventBus.off('event', onRealtimeEvent)
      for (const client of sseClients) client.end()
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}
