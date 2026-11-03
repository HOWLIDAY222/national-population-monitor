import { makeId, nowIso } from './domain/schemas.js'
import { discoverPortalResources } from './discovery/portal-link-discovery.js'
import { parseSourceContent } from './parsers/index.js'

export class CollectionPipeline {
  constructor({ repository, collector, validator, publisher, eventBus, logger }) {
    this.repository = repository
    this.collector = collector
    this.validator = validator
    this.publisher = publisher
    this.eventBus = eventBus
    this.logger = logger
  }

  async processSource(sourceId, { forceDiscovery = false } = {}) {
    const source = await this.repository.getSource(sourceId)
    if (!source || !source.enabled) throw new Error(`Source is unavailable: ${sourceId}`)
    let collection = await this.collector.collect(source)
    if (source.monitorOnly && forceDiscovery && collection.outcome === 'unchanged' && !collection.buffer) {
      const existingDiscoveries = await this.repository.listDiscoveries(1, { sourceId })
      if (!existingDiscoveries.length) {
        collection = await this.collector.collect({ ...source, etag: null, lastModified: null })
      }
    }
    if (collection.outcome !== 'changed') {
      if (source.monitorOnly && collection.buffer) {
        const discoveries = await this.#discoverPortalResources(source, collection, null)
        if (discoveries.newItems.length || discoveries.changedItems.length) {
          const discoveryEvent = this.#discoveryEvent(source, discoveries)
          await this.repository.appendEvents([discoveryEvent])
          this.eventBus.publish(discoveryEvent)
          return {
            sourceId,
            outcome: collection.outcome,
            discoveredResources: discoveries.items.length,
            newDiscoveries: discoveries.newItems.length,
          }
        }
      }
      const event = this.#pipelineEvent(source, null, 'source.checked', '数据源检查完成，内容未变化', 'success', {
        outcome: collection.outcome,
      })
      this.eventBus.publish(event)
      return { sourceId, outcome: collection.outcome }
    }

    if (source.monitorOnly) {
      const discoveries = await this.#discoverPortalResources(source, collection, collection.snapshot.id)
      const event = this.#pipelineEvent(source, null, 'source.changed', '公开统计门户内容发生变化，已保存原始快照并等待发现规则处理', 'info', {
        contentHash: collection.snapshot.contentHash,
        rawSnapshotId: collection.snapshot.id,
        role: source.role,
        discoveredResources: discoveries.items.length,
        newDiscoveries: discoveries.newItems.length,
      })
      const events = [event]
      if (discoveries.newItems.length || discoveries.changedItems.length) {
        events.push(this.#discoveryEvent(source, discoveries))
      }
      await this.repository.appendEvents(events)
      for (const item of events) this.eventBus.publish(item)
      return {
        sourceId,
        outcome: 'monitored_change',
        rawSnapshotId: collection.snapshot.id,
        discoveredResources: discoveries.items.length,
        newDiscoveries: discoveries.newItems.length,
      }
    }

    const parserRun = await this.repository.createParserRun({
      rawSnapshotId: collection.snapshot.id,
      parserType: source.parserType,
      parserVersion: source.parserVersion,
    })
    try {
      const definitions = await this.repository.listDefinitions()
      const records = await parseSourceContent({
        source,
        buffer: collection.buffer,
        definitions,
        collectedAt: collection.snapshot.collectedAt,
      })
      await this.repository.finishParserRun(parserRun.id, { status: 'succeeded', recordCount: records.length })
      const staging = await this.repository.saveStagingRecords(parserRun.id, records)
      const validation = await this.validator.validate(parserRun.id, staging, source)
      if (validation.rejected) {
        const event = this.#pipelineEvent(source, parserRun.id, 'validation.rejected', '数据校验未通过，继续使用上一有效版本', 'error', { issues: validation.issues.length })
        await this.repository.appendEvents([event])
        this.eventBus.publish(event)
        return { sourceId, outcome: 'rejected', parserRunId: parserRun.id, validation }
      }
      if (validation.canAutoPublish && source.autoPublish) {
        const published = await this.publisher.publishParserRun(parserRun.id, { actor: 'auto-publisher', approved: false })
        return { sourceId, outcome: 'published', parserRunId: parserRun.id, validation, published }
      }
      const event = this.#pipelineEvent(source, parserRun.id, 'validation.pending', '新数据已解析并等待审核，当前继续使用上一有效版本', 'warning', {
        records: staging.length,
        issues: validation.issues.length,
      })
      await this.repository.appendEvents([event])
      this.eventBus.publish(event)
      return { sourceId, outcome: 'review_required', parserRunId: parserRun.id, validation }
    } catch (error) {
      await this.repository.finishParserRun(parserRun.id, { status: 'failed', errorMessage: error.message })
      // Collection success and parser success form one checkpoint. If parsing fails,
      // restore the previous conditional-request markers so the same payload can be
      // fetched and reprocessed after a parser/configuration repair.
      await this.repository.updateSource(source.id, {
        status: 'delayed',
        etag: source.etag,
        lastModified: source.lastModified,
        lastContentHash: source.lastContentHash,
        consecutiveFailures: (source.consecutiveFailures ?? 0) + 1,
        lastError: `Parser failed: ${error.message}`,
      })
      const event = this.#pipelineEvent(source, parserRun.id, 'parser.failed', '数据解析失败，继续使用上一有效版本', 'error', { error: error.message })
      await this.repository.appendEvents([event])
      this.eventBus.publish(event)
      await this.logger.error('parser.failed', { sourceId, parserRunId: parserRun.id, error })
      throw error
    }
  }

  async #discoverPortalResources(source, collection, snapshotId) {
    const candidates = discoverPortalResources({ buffer: collection.buffer, source })
    return this.repository.saveDiscoveredResources({
      sourceId: source.id,
      regionCode: source.regionCode,
      snapshotId,
      discoveredAt: collection.snapshot?.collectedAt ?? collection.check.finishedAt,
      resources: candidates,
    })
  }

  #discoveryEvent(source, discoveries) {
    return this.#pipelineEvent(source, null, 'source.discovery', '发现新的或已变化的人口统计资源候选，等待建立正式数据适配器', 'warning', {
      newDiscoveries: discoveries.newItems.length,
      changedDiscoveries: discoveries.changedItems.length,
      resources: [...discoveries.newItems, ...discoveries.changedItems].slice(0, 10).map((item) => ({
        title: item.title,
        resourceUrl: item.resourceUrl,
        resourceKind: item.resourceKind,
      })),
    })
  }

  #pipelineEvent(source, parserRunId, eventType, message, severity, details) {
    const at = nowIso()
    return {
      id: makeId(), eventType, occurredAt: at, regionCode: source.regionCode ?? null, regionName: source.regionName ?? '全国', indicatorCode: null,
      indicatorName: message, previousValue: null, currentValue: null, unit: null,
      sourceId: source.id, sourceName: source.name, sourceUrl: source.url, triggerRule: message,
      versionId: null, versionCode: null, severity, details: { ...details, parserRunId }, createdAt: at,
    }
  }
}
