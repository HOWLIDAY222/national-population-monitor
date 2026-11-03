import { createApplication } from '../application.js'
import { loadConfig } from '../config.js'

const requestedConcurrency = Number(process.env.PORTAL_AUDIT_CONCURRENCY ?? 4)
const concurrency = Math.max(1, Math.min(8, Number.isFinite(requestedConcurrency) ? requestedConcurrency : 4))
const application = await createApplication(loadConfig({ ...process.env, SCHEDULER_ENABLED: 'false' }))
const onlyUnhealthy = process.argv.includes('--unhealthy')
const refreshDiscovery = process.argv.includes('--refresh-discovery')
const sources = (await application.repository.listSources()).filter((source) => (
  source.enabled && source.role === 'portal' && (!onlyUnhealthy || source.status !== 'healthy')
))
const results = []
let cursor = 0

async function worker() {
  while (cursor < sources.length) {
    const source = sources[cursor]
    cursor += 1
    const startedAt = new Date().toISOString()
    try {
      const result = await application.pipeline.processSource(source.id, { forceDiscovery: refreshDiscovery })
      const current = await application.repository.getSource(source.id)
      results.push({
        sourceId: source.id,
        regionCode: source.regionCode,
        regionName: source.regionName,
        url: source.url,
        outcome: result.outcome,
        status: current.status,
        checkedAt: current.lastCheckedAt,
        contentHash: current.lastContentHash,
        discoveredResources: result.discoveredResources ?? null,
        newDiscoveries: result.newDiscoveries ?? null,
        warning: current.lastError,
        error: null,
      })
    } catch (error) {
      const current = await application.repository.getSource(source.id)
      results.push({
        sourceId: source.id,
        regionCode: source.regionCode,
        regionName: source.regionName,
        url: source.url,
        outcome: 'failed',
        status: current?.status ?? 'failed',
        checkedAt: current?.lastCheckedAt ?? startedAt,
        contentHash: current?.lastContentHash ?? null,
        warning: null,
        error: error.message,
      })
    }
  }
}

try {
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length || 1) }, () => worker()))
  results.sort((a, b) => a.regionCode.localeCompare(b.regionCode))
  const failed = results.filter((item) => item.outcome === 'failed')
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    configured: sources.length,
    scope: onlyUnhealthy ? 'unhealthy' : 'all',
    refreshDiscovery,
    reachable: results.length - failed.length,
    failed: failed.length,
    items: results,
  }, null, 2))
  if (failed.length) process.exitCode = 1
} finally {
  await application.repository.close()
}
