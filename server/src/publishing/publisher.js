import { createHash } from 'node:crypto'
import { makeId, nowIso } from '../domain/schemas.js'

const shortHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 10)

export class VersionPublisher {
  constructor({ repository, eventBus, logger }) {
    this.repository = repository
    this.eventBus = eventBus
    this.logger = logger
  }

  async publishParserRun(parserRunId, { actor = 'system', approved = false } = {}) {
    const records = await this.repository.getStagingRun(parserRunId)
    if (!records.length) throw new Error('Parser run has no staging records')
    if (records.some((record) => record.qualityStatus === 'rejected')) throw new Error('Rejected records cannot be published')
    if (!approved && records.some((record) => record.qualityStatus === 'review_required')) {
      throw new Error('This dataset requires explicit review approval')
    }
    if (records.some((record) => record.qualityStatus === 'pending')) throw new Error('Pending records cannot be published')

    const source = await this.repository.getSource(records[0].sourceId)
    const publishedAt = nowIso()
    const signature = records
      .map((record) => `${record.indicatorCode}:${record.regionCode}:${record.period}:${record.value}:${record.unit}`)
      .sort()
      .join('|')
    const version = {
      id: makeId(),
      versionCode: `${source.datasetKey}-${source.period}-${shortHash(`${signature}|${parserRunId}`)}`,
      datasetKey: source.datasetKey,
      period: source.period,
      status: 'published',
      qualityStatus: approved ? 'reviewed' : 'verified',
      parserRunId,
      replacesVersionId: null,
      rollbackOfVersionId: null,
      recordCount: records.length,
      changeSummary: {},
      createdBy: actor,
      createdAt: publishedAt,
      publishedAt,
      rolledBackAt: null,
    }
    const events = []
    const publishedRecords = []
    let changedRecords = 0
    let currentUpdates = 0
    let historicalBackfillRecords = 0
    for (const record of records) {
      const previous = await this.repository.getLatestRecord(record.indicatorCode, record.regionCode)
      const changed = !previous || previous.value !== record.value || previous.unit !== record.unit || previous.period !== record.period
      const isHistoricalBackfill = previous && new Date(record.effectiveAt) < new Date(previous.effectiveAt)
      if (changed) changedRecords += 1
      if (changed && isHistoricalBackfill) historicalBackfillRecords += 1
      if (changed && !isHistoricalBackfill) currentUpdates += 1
      const publishedRecord = {
        ...record,
        id: makeId(),
        versionId: version.id,
        platformPublishedAt: publishedAt,
        qualityStatus: approved ? 'reviewed' : 'verified',
        createdAt: publishedAt,
      }
      delete publishedRecord.parserRunId
      publishedRecords.push(publishedRecord)
      if (changed) {
        events.push({
          id: makeId(),
          eventType: isHistoricalBackfill ? 'indicator.history_added' : 'indicator.updated',
          occurredAt: publishedAt,
          regionCode: record.regionCode,
          regionName: record.regionName,
          indicatorCode: record.indicatorCode,
          indicatorName: record.indicatorName,
          previousValue: isHistoricalBackfill ? null : previous?.value ?? null,
          currentValue: record.value,
          unit: record.unit,
          sourceId: record.sourceId,
          sourceName: record.sourceName,
          sourceUrl: record.sourceUrl,
          triggerRule: isHistoricalBackfill
            ? '补录早于当前快照的正式历史数据'
            : previous ? '新正式版本与上一有效版本不同' : '首次发布正式指标',
          versionId: version.id,
          versionCode: version.versionCode,
          severity: previous ? 'info' : 'success',
          details: {
            period: record.period,
            sourcePublishedAt: record.sourcePublishedAt,
            collectedAt: record.collectedAt,
            ...(isHistoricalBackfill ? { currentSnapshotPeriod: previous.period, currentSnapshotValue: previous.value } : {}),
          },
          createdAt: publishedAt,
        })
      }
    }
    version.changeSummary = { changedRecords, currentUpdates, historicalBackfillRecords, totalRecords: records.length }
    events.unshift({
      id: makeId(), eventType: 'version.published', occurredAt: publishedAt, regionCode: null, regionName: '全国',
      indicatorCode: null, indicatorName: '数据版本', previousValue: null, currentValue: null, unit: null,
      sourceId: source.id, sourceName: source.name, sourceUrl: source.url,
      triggerRule: approved ? '人工审核通过后发布' : '自动发布规则通过', versionId: version.id, versionCode: version.versionCode,
      severity: 'success', details: { actor, changedRecords, currentUpdates, historicalBackfillRecords, totalRecords: records.length }, createdAt: publishedAt,
    })
    const result = await this.repository.publishVersion({ version, records: publishedRecords, events })
    for (const event of result.events) this.eventBus.publish(event)
    await this.logger.info('version.published', { versionCode: version.versionCode, actor, changedRecords })
    return result
  }

  async rollback(versionId, actor) {
    const result = await this.repository.rollbackVersion(versionId, actor)
    this.eventBus.publish(result.event)
    await this.logger.warn('version.rolled_back', { versionId, actor, activeVersion: result.activeVersion.versionCode })
    return result
  }
}
