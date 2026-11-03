import { createApplication } from '../application.js'

const approve = process.argv.includes('--approve')
const actorArgument = process.argv.find((argument) => argument.startsWith('--actor='))
const actor = actorArgument?.slice('--actor='.length) || 'provincial-annual-reviewer'
const sourceFilter = process.env.PROVINCIAL_ANNUAL_SOURCE_IDS ?? process.env.PROVINCIAL_ANNUAL_SOURCE_ID ?? ''
const sourceFilters = new Set(sourceFilter.split(',').map((value) => value.trim()).filter(Boolean))
const application = await createApplication()

try {
  const sources = (await application.repository.listSources())
    .filter((source) => source.enabled
      && source.parserType === 'provincial-annual-bulletin'
      && (!sourceFilters.size || sourceFilters.has(source.id)))
    .sort((left, right) => left.regionCode.localeCompare(right.regionCode))
  if (sourceFilters.size && sources.length !== sourceFilters.size) {
    const found = new Set(sources.map((source) => source.id))
    const missing = [...sourceFilters].filter((sourceId) => !found.has(sourceId))
    throw new Error(`Provincial annual source was not found or is disabled: ${missing.join(', ')}`)
  }
  const reviewRuns = await application.repository.listReviewRuns(500)
  const latestBySource = new Map()
  for (const run of reviewRuns) {
    if (!latestBySource.has(run.sourceId)) latestBySource.set(run.sourceId, run)
  }

  const preflight = []
  for (const source of sources) {
    const summary = latestBySource.get(source.id)
    if (!summary) {
      preflight.push({ sourceId: source.id, regionCode: source.regionCode, ready: false, errors: ['no review run'] })
      continue
    }
    const detail = await application.repository.getReviewRun(summary.parserRunId)
    const errors = []
    if (summary.blockingIssueCount > 0) errors.push(`${summary.blockingIssueCount} blocking issue(s)`)
    if (!detail?.rawSnapshot?.contentHash) errors.push('missing raw content hash')
    if (detail?.source?.id !== source.id) errors.push('source mismatch')
    const expectedHash = source.parserConfig?.expectedContentHash
    if (expectedHash && detail?.rawSnapshot?.contentHash !== expectedHash) errors.push('audited content hash mismatch')
    const minimumRecords = source.parserConfig?.minimumRecords ?? 1
    if ((detail?.records?.length ?? 0) < minimumRecords) errors.push(`record count below ${minimumRecords}`)
    if (detail?.records?.filter((record) => record.indicatorCode === 'province_population_total').length !== 1) {
      errors.push('province population total must occur exactly once')
    }
    if (detail?.records?.some((record) => record.sourceId !== source.id
      || record.regionCode !== source.regionCode
      || record.period !== source.period
      || record.qualityStatus !== 'review_required')) {
      errors.push('staging record scope or quality status mismatch')
    }
    preflight.push({
      sourceId: source.id,
      regionCode: source.regionCode,
      regionName: source.regionName,
      parserRunId: summary.parserRunId,
      contentHash: detail?.rawSnapshot?.contentHash ?? null,
      records: detail?.records?.length ?? 0,
      values: Object.fromEntries((detail?.records ?? []).map((record) => [record.indicatorCode, record.value])),
      issueCodes: [...new Set((detail?.issues ?? []).map((issue) => issue.ruleCode))].sort(),
      ready: errors.length === 0,
      errors,
    })
  }

  const notReady = preflight.filter((item) => !item.ready)
  if (notReady.length) {
    console.log(JSON.stringify({ mode: approve ? 'approve' : 'audit', configured: sources.length, ready: preflight.length - notReady.length, notReady, items: preflight }, null, 2))
    process.exitCode = 1
  } else if (!approve) {
    console.log(JSON.stringify({ mode: 'audit', configured: sources.length, ready: preflight.length, items: preflight }, null, 2))
  } else {
    const published = []
    for (const item of preflight) {
      const result = await application.publisher.publishParserRun(item.parserRunId, { actor, approved: true })
      published.push({
        sourceId: item.sourceId,
        regionCode: item.regionCode,
        parserRunId: item.parserRunId,
        versionId: result.version.id,
        versionCode: result.version.versionCode,
        records: result.records.length,
      })
    }
    console.log(JSON.stringify({ mode: 'approve', actor, configured: sources.length, published: published.length, items: published }, null, 2))
  }
} finally {
  await application.repository.close()
}
