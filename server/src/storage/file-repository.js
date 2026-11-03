import fs from 'node:fs/promises'
import path from 'node:path'
import { makeId, nowIso, parseDefinitions, parseSources } from '../domain/schemas.js'

const clone = (value) => structuredClone(value)
const byNewest = (a, b, key = 'createdAt') => new Date(b[key] ?? 0) - new Date(a[key] ?? 0)
const runtimeSourceState = (source, baseTime = Date.now()) => ({
  ...source,
  status: source.enabled ? 'pending' : 'disabled',
  etag: null,
  lastModified: null,
  lastContentHash: null,
  lastCheckedAt: null,
  lastSuccessAt: null,
  nextCheckAt: new Date(baseTime + source.initialDelaySeconds * 1000).toISOString(),
  consecutiveFailures: 0,
  lastError: null,
})

const sourceRuntimeKeys = [
  'status', 'etag', 'lastModified', 'lastContentHash', 'lastCheckedAt', 'lastSuccessAt',
  'nextCheckAt', 'consecutiveFailures', 'lastError',
]

export class FileRepository {
  constructor({ directory, sourcesPath, bootstrapPath }) {
    this.directory = directory
    this.sourcesPath = sourcesPath
    this.bootstrapPath = bootstrapPath
    this.statePath = path.join(directory, 'state.json')
    this.state = null
    this.writeQueue = Promise.resolve()
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true })
    try {
      this.state = JSON.parse(await fs.readFile(this.statePath, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.state = await this.#buildInitialState()
      await this.#persist()
    }
    await this.#syncConfiguredReferenceData()
    return this
  }

  async #syncConfiguredReferenceData() {
    const previous = JSON.stringify({
      sources: this.state.sources,
      definitions: this.state.definitions,
      regions: this.state.regions,
      discoveredResources: this.state.discoveredResources,
      events: this.state.events,
    })
    this.state.discoveredResources ??= []
    const [configuredSourcesInput, bootstrap] = await Promise.all([
      fs.readFile(this.sourcesPath, 'utf8').then(JSON.parse),
      fs.readFile(this.bootstrapPath, 'utf8').then(JSON.parse),
    ])
    const configured = parseSources(configuredSourcesInput)
    const configuredDefinitions = parseDefinitions(bootstrap.indicatorDefinitions)
    const configuredIds = new Set(configured.map((source) => source.id))
    const existingById = new Map(this.state.sources.map((source) => [source.id, source]))
    const baseTime = Date.now()

    for (const source of configured) {
      const existing = existingById.get(source.id)
      if (!existing) {
        this.state.sources.push(runtimeSourceState(source, baseTime))
        continue
      }
      const collectionContractChanged = existing.url !== source.url || existing.parserVersion !== source.parserVersion
      const runtime = Object.fromEntries(sourceRuntimeKeys.map((key) => [key, existing[key]]))
      Object.assign(existing, source, runtime)
      if (collectionContractChanged && source.enabled) {
        existing.status = 'pending'
        existing.etag = null
        existing.lastModified = null
        existing.lastContentHash = null
        existing.lastCheckedAt = null
        existing.lastSuccessAt = null
        existing.nextCheckAt = new Date(baseTime + source.initialDelaySeconds * 1000).toISOString()
        existing.consecutiveFailures = 0
        existing.lastError = null
      }
      if (!source.enabled) existing.status = 'disabled'
      if (source.enabled && existing.status === 'disabled') {
        existing.status = 'pending'
        existing.nextCheckAt = new Date(baseTime + source.initialDelaySeconds * 1000).toISOString()
      }
    }

    for (const source of this.state.sources) {
      if (configuredIds.has(source.id)) continue
      source.enabled = false
      source.status = 'disabled'
    }

    const existingDefinitions = new Map(this.state.definitions.map((definition) => [definition.code, definition]))
    for (const definition of configuredDefinitions) {
      const existing = existingDefinitions.get(definition.code)
      if (existing) Object.assign(existing, definition)
      else this.state.definitions.push(definition)
    }

    const existingRegions = new Map(this.state.regions.map((region) => [region.code, region]))
    for (const region of bootstrap.regions) {
      const existing = existingRegions.get(region.code)
      if (existing) Object.assign(existing, region)
      else this.state.regions.push(region)
    }

    const publishedParserRuns = new Set(this.state.versions
      .filter((version) => version.status === 'published' && version.parserRunId)
      .map((version) => version.parserRunId))
    for (const record of this.state.stagingRecords) {
      if (publishedParserRuns.has(record.parserRunId)) record.qualityStatus = 'verified'
    }

    const publishedVersionIds = new Set(this.state.versions
      .filter((version) => version.status === 'published')
      .map((version) => version.id))
    for (const event of this.state.events) {
      if (event.eventType !== 'indicator.updated' || !event.versionId || !event.indicatorCode || !event.regionCode) continue
      const eventRecord = this.state.indicatorRecords.find((record) => (
        record.versionId === event.versionId
        && record.indicatorCode === event.indicatorCode
        && record.regionCode === event.regionCode
      ))
      if (!eventRecord) continue
      const newer = this.state.indicatorRecords
        .filter((record) => (
          publishedVersionIds.has(record.versionId)
          && record.indicatorCode === event.indicatorCode
          && record.regionCode === event.regionCode
          && new Date(record.effectiveAt) > new Date(eventRecord.effectiveAt)
        ))
        .sort((a, b) => byNewest(a, b, 'effectiveAt'))[0]
      if (!newer) continue
      event.eventType = 'indicator.history_added'
      event.previousValue = null
      event.triggerRule = '补录早于当前快照的正式历史数据'
      event.details = {
        ...(event.details ?? {}),
        currentSnapshotPeriod: newer.period,
        currentSnapshotValue: newer.value,
      }
    }

    const current = JSON.stringify({
      sources: this.state.sources,
      definitions: this.state.definitions,
      regions: this.state.regions,
      discoveredResources: this.state.discoveredResources,
      events: this.state.events,
    })
    if (current !== previous) await this.#persist()
  }

  async #buildInitialState() {
    const [sourceInput, bootstrap] = await Promise.all([
      fs.readFile(this.sourcesPath, 'utf8').then(JSON.parse),
      fs.readFile(this.bootstrapPath, 'utf8').then(JSON.parse),
    ])
    const initializedAt = Date.now()
    const sources = parseSources(sourceInput).map((source) => runtimeSourceState(source, initializedAt))
    const definitions = parseDefinitions(bootstrap.indicatorDefinitions)
    const sourceMap = new Map(sources.map((source) => [source.id, source]))
    const definitionMap = new Map(definitions.map((definition) => [definition.code, definition]))
    const versions = []
    const indicatorRecords = []
    const events = []
    const collectedAt = nowIso()

    for (const seed of bootstrap.versions) {
      const versionId = makeId()
      const source = sourceMap.get(seed.sourceId)
      const version = {
        id: versionId,
        versionCode: seed.versionCode,
        datasetKey: seed.datasetKey,
        period: seed.period,
        status: seed.status,
        qualityStatus: seed.qualityStatus,
        parserRunId: null,
        replacesVersionId: null,
        rollbackOfVersionId: null,
        recordCount: seed.records.length,
        changeSummary: { bootstrap: true },
        createdBy: 'bootstrap',
        createdAt: seed.publishedAt,
        publishedAt: seed.publishedAt,
        rolledBackAt: null,
      }
      versions.push(version)
      for (const [indicatorCode, value, unit] of seed.records) {
        const definition = definitionMap.get(indicatorCode)
        indicatorRecords.push({
          id: makeId(),
          versionId,
          indicatorCode,
          indicatorName: definition.name,
          regionCode: 'CN',
          regionName: '全国',
          period: seed.period,
          value,
          unit,
          frequency: definition.frequency,
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.url,
          sourcePublishedAt: seed.publishedAt,
          collectedAt,
          effectiveAt: source.effectiveAt,
          platformPublishedAt: seed.publishedAt,
          dataStatus: source.dataStatus,
          parserVersion: `${source.parserVersion}-bootstrap`,
          qualityStatus: seed.qualityStatus,
          dimensions: { bootstrap: true },
          createdAt: seed.publishedAt,
        })
      }
      events.push({
        id: makeId(),
        eventType: 'version.published',
        occurredAt: seed.publishedAt,
        regionCode: 'CN',
        regionName: '全国',
        indicatorCode: null,
        indicatorName: '正式数据版本',
        previousValue: null,
        currentValue: null,
        unit: null,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        triggerRule: '人工核验的官方启动版本',
        versionId,
        versionCode: seed.versionCode,
        severity: 'success',
        details: { bootstrap: true },
        createdAt: seed.publishedAt,
      })
    }

    return {
      schemaVersion: 1,
      createdAt: nowIso(),
      regions: bootstrap.regions,
      definitions,
      sources,
      sourceChecks: [],
      rawSnapshots: [],
      discoveredResources: [],
      parserRuns: [],
      stagingRecords: [],
      validationIssues: [],
      versions,
      indicatorRecords,
      events,
      jobs: [],
    }
  }

  async #persist(payload = JSON.stringify(this.state, null, 2)) {
    const tempPath = `${this.statePath}.${process.pid}.tmp`
    await fs.writeFile(tempPath, payload, 'utf8')
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(tempPath, this.statePath)
        break
      } catch (error) {
        const retryable = ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)
        if (!retryable || attempt >= 5) throw error
        await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt)))
      }
    }
  }

  async #mutate(mutator) {
    const operation = this.writeQueue.then(async () => {
      const previousPayload = JSON.stringify(this.state, null, 2)
      const result = await mutator(this.state)
      const nextPayload = JSON.stringify(this.state, null, 2)
      if (nextPayload !== previousPayload) await this.#persist(nextPayload)
      return clone(result)
    })
    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  async listSources() { return clone(this.state.sources) }
  async getSource(id) { return clone(this.state.sources.find((item) => item.id === id) ?? null) }
  async listDefinitions() { return clone(this.state.definitions) }
  async listRegions() { return clone(this.state.regions) }

  async updateSource(id, patch) {
    return this.#mutate((state) => {
      const source = state.sources.find((item) => item.id === id)
      if (!source) throw new Error(`Unknown source: ${id}`)
      Object.assign(source, patch)
      return source
    })
  }

  async enqueueDueSources(at = nowIso()) {
    return this.#mutate((state) => {
      const due = state.sources.filter((source) => source.enabled && new Date(source.nextCheckAt) <= new Date(at))
      const created = []
      for (const source of due) {
        const activeJob = state.jobs.some((job) => job.sourceId === source.id && ['pending', 'retry', 'processing'].includes(job.status))
        if (!activeJob) {
          const job = {
            id: makeId(), sourceId: source.id, status: 'pending', priority: 100, attempts: 0, maxAttempts: 5,
            availableAt: at, workerId: null, startedAt: null, finishedAt: null, lastError: null, createdAt: at, updatedAt: at,
          }
          state.jobs.push(job)
          created.push(job)
        }
        source.nextCheckAt = new Date(new Date(at).getTime() + source.checkIntervalSeconds * 1000).toISOString()
      }
      return created
    })
  }

  async enqueueSource(sourceId, { priority = 10 } = {}) {
    return this.#mutate((state) => {
      if (!state.sources.some((source) => source.id === sourceId)) throw new Error(`Unknown source: ${sourceId}`)
      const active = state.jobs.find((job) => job.sourceId === sourceId && ['pending', 'retry', 'processing'].includes(job.status))
      if (active) return active
      const at = nowIso()
      const job = {
        id: makeId(), sourceId, status: 'pending', priority, attempts: 0, maxAttempts: 5,
        availableAt: at, workerId: null, startedAt: null, finishedAt: null, lastError: null, createdAt: at, updatedAt: at,
      }
      state.jobs.push(job)
      return job
    })
  }

  async claimJob(workerId, at = nowIso()) {
    return this.#mutate((state) => {
      const job = state.jobs
        .filter((item) => ['pending', 'retry'].includes(item.status) && new Date(item.availableAt) <= new Date(at))
        .sort((a, b) => a.priority - b.priority || new Date(a.createdAt) - new Date(b.createdAt))[0]
      if (!job) return null
      job.status = 'processing'
      job.workerId = workerId
      job.startedAt = at
      job.attempts += 1
      job.updatedAt = at
      return job
    })
  }

  async recoverStaleJobs(at = nowIso(), staleMs = 10 * 60 * 1000) {
    return this.#mutate((state) => {
      const cutoff = new Date(at).getTime() - staleMs
      const recovered = []
      for (const job of state.jobs) {
        if (job.status !== 'processing' || !job.startedAt || new Date(job.startedAt).getTime() > cutoff) continue
        const exhausted = job.attempts >= job.maxAttempts
        job.status = exhausted ? 'failed' : 'retry'
        job.availableAt = at
        job.finishedAt = exhausted ? at : null
        job.workerId = null
        job.lastError = 'Recovered after worker lease expired'
        job.updatedAt = at
        recovered.push(job)
      }
      return recovered
    })
  }

  async completeJob(jobId) {
    return this.#mutate((state) => {
      const job = state.jobs.find((item) => item.id === jobId)
      if (!job) throw new Error(`Unknown job: ${jobId}`)
      job.status = 'completed'
      job.finishedAt = nowIso()
      job.updatedAt = job.finishedAt
      return job
    })
  }

  async failJob(jobId, errorMessage) {
    return this.#mutate((state) => {
      const job = state.jobs.find((item) => item.id === jobId)
      if (!job) throw new Error(`Unknown job: ${jobId}`)
      const exhausted = job.attempts >= job.maxAttempts
      const backoffSeconds = Math.min(900, 15 * (2 ** Math.max(0, job.attempts - 1)))
      job.status = exhausted ? 'failed' : 'retry'
      job.availableAt = new Date(Date.now() + backoffSeconds * 1000).toISOString()
      job.finishedAt = exhausted ? nowIso() : null
      job.lastError = errorMessage
      job.updatedAt = nowIso()
      return job
    })
  }

  async recordSourceCheck(input) {
    return this.#mutate((state) => {
      const check = { id: makeId(), ...input }
      state.sourceChecks.push(check)
      return check
    })
  }

  async saveRawSnapshot(input) {
    return this.#mutate((state) => {
      const existing = state.rawSnapshots.find((item) => item.sourceId === input.sourceId && item.contentHash === input.contentHash)
      if (existing) return { snapshot: existing, isNew: false }
      const snapshot = { id: makeId(), createdAt: nowIso(), ...input }
      state.rawSnapshots.push(snapshot)
      return { snapshot, isNew: true }
    })
  }

  async saveDiscoveredResources({ sourceId, regionCode, snapshotId, discoveredAt = nowIso(), resources }) {
    return this.#mutate((state) => {
      const items = []
      const newItems = []
      const changedItems = []
      const staleItems = []
      const seenUrls = new Set(resources.map((resource) => resource.resourceUrl))
      for (const resource of resources) {
        const existing = state.discoveredResources.find((item) => item.sourceId === sourceId && item.resourceUrl === resource.resourceUrl)
        if (!existing) {
          const created = {
            id: makeId(), sourceId, regionCode, title: resource.title, resourceUrl: resource.resourceUrl,
            resourceKind: resource.resourceKind, status: 'candidate', firstSeenAt: discoveredAt,
            lastSeenAt: discoveredAt, lastChangedAt: discoveredAt, discoveredFromSnapshotId: snapshotId,
            metadata: resource.metadata ?? {},
          }
          state.discoveredResources.push(created)
          items.push(created)
          newItems.push(created)
          continue
        }
        const changed = existing.title !== resource.title
          || existing.resourceKind !== resource.resourceKind
          || existing.status === 'stale'
          || JSON.stringify(existing.metadata) !== JSON.stringify(resource.metadata ?? {})
        Object.assign(existing, {
          regionCode,
          title: resource.title,
          resourceKind: resource.resourceKind,
          lastSeenAt: discoveredAt,
          discoveredFromSnapshotId: snapshotId,
          metadata: resource.metadata ?? {},
        })
        if (existing.status === 'stale') existing.status = 'candidate'
        if (changed) {
          existing.lastChangedAt = discoveredAt
          changedItems.push(existing)
        }
        items.push(existing)
      }
      for (const existing of state.discoveredResources) {
        if (existing.sourceId !== sourceId || existing.status !== 'candidate' || seenUrls.has(existing.resourceUrl)) continue
        existing.status = 'stale'
        existing.lastChangedAt = discoveredAt
        staleItems.push(existing)
      }
      return { items, newItems, changedItems, staleItems }
    })
  }

  async createParserRun(input) {
    return this.#mutate((state) => {
      const run = { id: makeId(), status: 'running', recordCount: 0, startedAt: nowIso(), finishedAt: null, errorMessage: null, metadata: {}, ...input }
      state.parserRuns.push(run)
      return run
    })
  }

  async finishParserRun(id, patch) {
    return this.#mutate((state) => {
      const run = state.parserRuns.find((item) => item.id === id)
      if (!run) throw new Error(`Unknown parser run: ${id}`)
      Object.assign(run, patch, { finishedAt: nowIso() })
      return run
    })
  }

  async saveStagingRecords(parserRunId, records) {
    return this.#mutate((state) => {
      const created = records.map((record) => ({ id: makeId(), parserRunId, createdAt: nowIso(), ...record }))
      state.stagingRecords.push(...created)
      return created
    })
  }

  async saveValidationIssues(issues) {
    if (issues.length === 0) return []
    return this.#mutate((state) => {
      const created = issues.map((issue) => ({ id: makeId(), createdAt: nowIso(), ...issue }))
      state.validationIssues.push(...created)
      return created
    })
  }

  async updateStagingStatuses(statusById) {
    return this.#mutate((state) => {
      const updated = []
      for (const record of state.stagingRecords) {
        if (statusById[record.id]) {
          record.qualityStatus = statusById[record.id]
          updated.push(record)
        }
      }
      return updated
    })
  }

  async getStagingRun(parserRunId) {
    return clone(this.state.stagingRecords.filter((item) => item.parserRunId === parserRunId))
  }

  async getLatestRecord(indicatorCode, regionCode, { excludeVersionId = null } = {}) {
    const publishedIds = new Set(this.state.versions.filter((version) => version.status === 'published' && version.id !== excludeVersionId).map((version) => version.id))
    return clone(this.state.indicatorRecords
      .filter((record) => publishedIds.has(record.versionId) && record.indicatorCode === indicatorCode && record.regionCode === regionCode)
      .sort((a, b) => byNewest(a, b, 'effectiveAt'))[0] ?? null)
  }

  async publishVersion({ version, records, events }) {
    return this.#mutate((state) => {
      const duplicate = state.versions.find((item) => item.versionCode === version.versionCode)
      if (duplicate) return { version: duplicate, records: state.indicatorRecords.filter((item) => item.versionId === duplicate.id), events: [] }
      for (const current of state.versions) {
        if (current.datasetKey === version.datasetKey && current.period === version.period && current.status === 'published') {
          current.status = 'rolled_back'
          current.rolledBackAt = version.publishedAt
          version.replacesVersionId = current.id
        }
      }
      state.versions.push(version)
      state.indicatorRecords.push(...records)
      state.events.push(...events)
      for (const record of state.stagingRecords) {
        if (record.parserRunId === version.parserRunId) record.qualityStatus = 'verified'
      }
      return { version, records, events }
    })
  }

  async rollbackVersion(versionId, actor = 'system') {
    return this.#mutate((state) => {
      const version = state.versions.find((item) => item.id === versionId)
      if (!version || version.status !== 'published') throw new Error('Only a published version can be rolled back')
      const previous = state.versions.find((item) => item.id === version.replacesVersionId)
      if (!previous) throw new Error('No previous version is available')
      const at = nowIso()
      version.status = 'rolled_back'
      version.rolledBackAt = at
      previous.status = 'published'
      previous.rolledBackAt = null
      const event = {
        id: makeId(), eventType: 'version.rolled_back', occurredAt: at, regionCode: null, regionName: '全国', indicatorCode: null,
        indicatorName: '数据版本', previousValue: null, currentValue: null, unit: null, sourceId: null, sourceName: null, sourceUrl: null,
        triggerRule: '管理员回滚', versionId: previous.id, versionCode: previous.versionCode, severity: 'warning',
        details: { rolledBackVersion: version.versionCode, actor }, createdAt: at,
      }
      state.events.push(event)
      return { activeVersion: previous, event }
    })
  }

  async appendEvents(events) {
    if (!events.length) return []
    return this.#mutate((state) => {
      state.events.push(...events)
      return events
    })
  }

  async getSnapshot() {
    const published = this.state.versions.filter((version) => version.status === 'published')
    const publishedIds = new Set(published.map((version) => version.id))
    const latest = new Map()
    for (const record of this.state.indicatorRecords.filter((item) => publishedIds.has(item.versionId))) {
      const key = `${record.indicatorCode}:${record.regionCode}`
      const current = latest.get(key)
      if (!current || new Date(record.effectiveAt) > new Date(current.effectiveAt)) latest.set(key, record)
    }
    const status = await this.getStatus()
    return {
      generatedAt: nowIso(),
      versions: clone(published.sort((a, b) => byNewest(a, b, 'publishedAt'))),
      records: clone([...latest.values()]),
      status,
    }
  }

  async getIndicatorHistory(indicatorCode, regionCode = 'CN') {
    const versionMap = new Map(this.state.versions.map((version) => [version.id, version]))
    return clone(this.state.indicatorRecords
      .filter((record) => record.indicatorCode === indicatorCode && (regionCode === 'all' || record.regionCode === regionCode))
      .filter((record) => regionCode !== 'all' || versionMap.get(record.versionId)?.status === 'published')
      .map((record) => ({ ...record, versionStatus: versionMap.get(record.versionId)?.status }))
      .sort((a, b) => byNewest(a, b, 'effectiveAt')))
  }

  async getRegion(code) {
    const region = this.state.regions.find((item) => item.code === code)
    if (!region) return null
    const snapshot = await this.getSnapshot()
    return { ...clone(region), records: snapshot.records.filter((item) => item.regionCode === code) }
  }

  async listEvents(limit = 50) { return clone([...this.state.events].sort((a, b) => byNewest(a, b, 'occurredAt')).slice(0, limit)) }
  async listVersions(limit = 50) { return clone([...this.state.versions].sort((a, b) => byNewest(a, b, 'createdAt')).slice(0, limit)) }
  async listValidationIssues(limit = 100) { return clone([...this.state.validationIssues].sort((a, b) => byNewest(a, b)).slice(0, limit)) }
  async listDiscoveries(limit = 100, filters = {}) {
    return clone(this.state.discoveredResources
      .filter((item) => !filters.sourceId || item.sourceId === filters.sourceId)
      .filter((item) => !filters.regionCode || item.regionCode === filters.regionCode)
      .filter((item) => !filters.status || item.status === filters.status)
      .sort((a, b) => byNewest(a, b, 'lastSeenAt'))
      .slice(0, limit))
  }

  async listReviewRuns(limit = 50) {
    const summaries = []
    for (const run of this.state.parserRuns) {
      const records = this.state.stagingRecords.filter((record) => record.parserRunId === run.id)
      const pending = records.filter((record) => ['pending', 'review_required'].includes(record.qualityStatus))
      if (!pending.length) continue
      const rawSnapshot = this.state.rawSnapshots.find((snapshot) => snapshot.id === run.rawSnapshotId)
      const source = this.state.sources.find((item) => item.id === rawSnapshot?.sourceId)
      const issues = this.state.validationIssues.filter((item) => item.parserRunId === run.id)
      summaries.push({
        parserRunId: run.id,
        parserType: run.parserType,
        parserVersion: run.parserVersion,
        parserStatus: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        sourceId: source?.id ?? null,
        sourceName: source?.name ?? null,
        sourceUrl: source?.url ?? null,
        datasetKey: source?.datasetKey ?? null,
        period: source?.period ?? null,
        contentHash: rawSnapshot?.contentHash ?? null,
        collectedAt: rawSnapshot?.collectedAt ?? null,
        recordCount: records.length,
        pendingCount: pending.length,
        issueCount: issues.length,
        blockingIssueCount: issues.filter((item) => ['blocking', 'error'].includes(item.severity)).length,
      })
    }
    return clone(summaries.sort((a, b) => byNewest(a, b, 'finishedAt')).slice(0, limit))
  }

  async getReviewRun(parserRunId) {
    const run = this.state.parserRuns.find((item) => item.id === parserRunId)
    if (!run) return null
    const rawSnapshot = this.state.rawSnapshots.find((snapshot) => snapshot.id === run.rawSnapshotId)
    const source = this.state.sources.find((item) => item.id === rawSnapshot?.sourceId)
    const records = this.state.stagingRecords.filter((record) => record.parserRunId === parserRunId)
    const comparedRecords = []
    for (const record of records) {
      const previous = await this.getLatestRecord(record.indicatorCode, record.regionCode)
      comparedRecords.push({
        ...record,
        previousValue: previous?.value ?? null,
        previousPeriod: previous?.period ?? null,
        previousVersionId: previous?.versionId ?? null,
      })
    }
    return clone({
      parserRun: run,
      source: source ? {
        id: source.id,
        name: source.name,
        institution: source.institution,
        url: source.url,
        datasetKey: source.datasetKey,
        period: source.period,
      } : null,
      rawSnapshot: rawSnapshot ? {
        id: rawSnapshot.id,
        contentHash: rawSnapshot.contentHash,
        contentType: rawSnapshot.contentType,
        byteSize: rawSnapshot.byteSize,
        sourcePublishedAt: rawSnapshot.sourcePublishedAt,
        collectedAt: rawSnapshot.collectedAt,
      } : null,
      records: comparedRecords,
      issues: this.state.validationIssues.filter((item) => item.parserRunId === parserRunId),
    })
  }

  async getStatus() {
    const sources = this.state.sources
    const datasetSources = sources.filter((source) => source.role !== 'portal')
    const portalSources = sources.filter((source) => source.role === 'portal')
    const now = Date.now()
    const online = sources.filter((source) => source.status === 'healthy').length
    const delayed = sources.filter((source) => source.status === 'delayed' || (source.lastSuccessAt && now - new Date(source.lastSuccessAt).getTime() > source.checkIntervalSeconds * 3000)).length
    return {
      storage: 'file',
      connection: 'connected',
      totalSources: sources.length,
      onlineSources: online,
      datasetSources: datasetSources.length,
      onlineDatasetSources: datasetSources.filter((source) => source.status === 'healthy').length,
      portalSources: portalSources.length,
      onlinePortalSources: portalSources.filter((source) => source.status === 'healthy').length,
      delayedSources: delayed,
      failedSources: sources.filter((source) => source.status === 'failed').length,
      discoveredResources: this.state.discoveredResources.filter((item) => item.status === 'candidate').length,
      pendingValidation: this.state.stagingRecords.filter((record) => ['pending', 'review_required'].includes(record.qualityStatus)).length,
      publishedVersions: this.state.versions.filter((version) => version.status === 'published').length,
      lastCheckAt: [...this.state.sourceChecks].sort((a, b) => byNewest(a, b, 'finishedAt'))[0]?.finishedAt ?? null,
      latestVersion: [...this.state.versions].filter((version) => version.status === 'published').sort((a, b) => byNewest(a, b, 'publishedAt'))[0]?.versionCode ?? null,
      jobs: {
        pending: this.state.jobs.filter((job) => ['pending', 'retry'].includes(job.status)).length,
        processing: this.state.jobs.filter((job) => job.status === 'processing').length,
        failed: this.state.jobs.filter((job) => job.status === 'failed').length,
      },
    }
  }

  async close() {}
}
