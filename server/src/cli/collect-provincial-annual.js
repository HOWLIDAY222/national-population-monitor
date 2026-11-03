import { createApplication } from '../application.js'

const concurrency = Math.max(1, Math.min(6, Number(process.env.PROVINCIAL_ANNUAL_CONCURRENCY ?? 4)))
const sourceIdFilter = process.env.PROVINCIAL_ANNUAL_SOURCE_IDS ?? process.env.PROVINCIAL_ANNUAL_SOURCE_ID ?? ''
const sourceIdFilters = new Set(sourceIdFilter.split(',').map((value) => value.trim()).filter(Boolean))
const application = await createApplication()
const results = []

try {
  const sources = (await application.repository.listSources())
    .filter((source) => source.enabled
      && source.parserType === 'provincial-annual-bulletin'
      && (!sourceIdFilters.size || sourceIdFilters.has(source.id)))
  if (sourceIdFilters.size && sources.length !== sourceIdFilters.size) {
    const found = new Set(sources.map((source) => source.id))
    const missing = [...sourceIdFilters].filter((sourceId) => !found.has(sourceId))
    throw new Error(`Provincial annual source was not found or is disabled: ${missing.join(', ')}`)
  }
  let cursor = 0
  const worker = async () => {
    while (cursor < sources.length) {
      const source = sources[cursor++]
      try {
        const result = await application.pipeline.processSource(source.id)
        results.push({
          sourceId: source.id,
          regionCode: source.regionCode,
          outcome: result.outcome,
          parserRunId: result.parserRunId ?? null,
          records: result.validation ? Object.keys(result.validation.statusById).length : 0,
          issues: result.validation?.issues.length ?? 0,
          error: null,
        })
      } catch (error) {
        results.push({ sourceId: source.id, regionCode: source.regionCode, outcome: 'failed', parserRunId: null, records: 0, issues: 0, error: error.message })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker))
  results.sort((left, right) => left.regionCode.localeCompare(right.regionCode))
  const summary = Object.fromEntries([...new Set(results.map((item) => item.outcome))].map((outcome) => [outcome, results.filter((item) => item.outcome === outcome).length]))
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), configured: sources.length, concurrency, summary, items: results }, null, 2))
  if (results.some((item) => ['failed', 'rejected'].includes(item.outcome))) process.exitCode = 1
} finally {
  await application.repository.close()
}
