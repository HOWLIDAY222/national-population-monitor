import fs from 'node:fs/promises'
import { Pool } from 'pg'
import { makeId, nowIso, parseDefinitions, parseSources } from '../domain/schemas.js'

const camel = (key) => key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase())
const mapRow = (row, numeric = []) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
  const mappedKey = camel(key)
  return [mappedKey, numeric.includes(mappedKey) && value !== null ? Number(value) : value]
}))

const sourceFromRow = (row) => {
  const mapped = mapRow(row, ['checkIntervalSeconds', 'consecutiveFailures'])
  const config = mapped.config ?? {}
  delete mapped.config
  return { ...mapped, ...config }
}

const recordFromRow = (row) => mapRow(row, ['value'])
const eventFromRow = (row) => mapRow(row, ['previousValue', 'currentValue'])

export class PostgresRepository {
  constructor({ connectionString, sourcesPath, bootstrapPath }) {
    if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL storage')
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 })
    this.sourcesPath = sourcesPath
    this.bootstrapPath = bootstrapPath
  }

  async init() {
    await this.pool.query('select 1')
    await this.#seedReferenceData()
    return this
  }

  async #seedReferenceData() {
    const [sourcesInput, bootstrap] = await Promise.all([
      fs.readFile(this.sourcesPath, 'utf8').then(JSON.parse),
      fs.readFile(this.bootstrapPath, 'utf8').then(JSON.parse),
    ])
    const sources = parseSources(sourcesInput)
    const definitions = parseDefinitions(bootstrap.indicatorDefinitions)
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      for (const region of bootstrap.regions) {
        await client.query(
          `insert into population.regions(code, name, level, parent_code)
           values($1, $2, $3, $4)
           on conflict(code) do update set name = excluded.name, level = excluded.level, parent_code = excluded.parent_code`,
          [region.code, region.name, region.level, region.parentCode],
        )
      }
      for (const definition of definitions) {
        await client.query(
          `insert into population.indicator_definitions(
             code, name, description, default_unit, frequency, value_type, minimum_value, maximum_value, review_change_ratio, auto_publish
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict(code) do update set
             name=excluded.name, description=excluded.description, default_unit=excluded.default_unit,
             frequency=excluded.frequency, value_type=excluded.value_type, minimum_value=excluded.minimum_value,
             maximum_value=excluded.maximum_value, review_change_ratio=excluded.review_change_ratio,
             auto_publish=excluded.auto_publish, updated_at=now()`,
          [definition.code, definition.name, definition.description, definition.defaultUnit, definition.frequency, definition.valueType,
            definition.minimumValue, definition.maximumValue, definition.reviewChangeRatio, definition.autoPublish],
        )
      }
      for (const source of sources) {
        const config = {
          datasetKey: source.datasetKey, period: source.period, effectiveAt: source.effectiveAt,
          sourcePublishedAt: source.sourcePublishedAt, dataStatus: source.dataStatus,
          request: source.request, parserConfig: source.parserConfig, role: source.role,
          monitorOnly: source.monitorOnly, regionCode: source.regionCode, regionName: source.regionName,
          initialDelaySeconds: source.initialDelaySeconds, fallbackUrls: source.fallbackUrls,
        }
        await client.query(
          `insert into population.data_sources(
             id,name,institution,url,kind,parser_type,parser_version,check_interval_seconds,enabled,auto_publish,status,config,next_check_at
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now() + make_interval(secs=>$13))
           on conflict(id) do update set
             name=excluded.name,institution=excluded.institution,url=excluded.url,kind=excluded.kind,
             parser_type=excluded.parser_type,parser_version=excluded.parser_version,
             check_interval_seconds=excluded.check_interval_seconds,enabled=excluded.enabled,
             auto_publish=excluded.auto_publish,config=excluded.config,
             status=case
               when not excluded.enabled then 'disabled'
               when population.data_sources.url is distinct from excluded.url
                 or population.data_sources.parser_version is distinct from excluded.parser_version then 'pending'
               when population.data_sources.status='disabled' then 'pending'
               else population.data_sources.status
             end,
             etag=case when population.data_sources.url is distinct from excluded.url
               or population.data_sources.parser_version is distinct from excluded.parser_version then null else population.data_sources.etag end,
             last_modified=case when population.data_sources.url is distinct from excluded.url
               or population.data_sources.parser_version is distinct from excluded.parser_version then null else population.data_sources.last_modified end,
             last_content_hash=case when population.data_sources.url is distinct from excluded.url
               or population.data_sources.parser_version is distinct from excluded.parser_version then null else population.data_sources.last_content_hash end,
             last_checked_at=case when population.data_sources.url is distinct from excluded.url
               or population.data_sources.parser_version is distinct from excluded.parser_version then null else population.data_sources.last_checked_at end,
             last_success_at=case when population.data_sources.url is distinct from excluded.url
               or population.data_sources.parser_version is distinct from excluded.parser_version then null else population.data_sources.last_success_at end,
             next_check_at=case when population.data_sources.url is distinct from excluded.url
               or population.data_sources.parser_version is distinct from excluded.parser_version then excluded.next_check_at else population.data_sources.next_check_at end,
             consecutive_failures=case when population.data_sources.url is distinct from excluded.url
               or population.data_sources.parser_version is distinct from excluded.parser_version then 0 else population.data_sources.consecutive_failures end,
             last_error=case when population.data_sources.url is distinct from excluded.url
               or population.data_sources.parser_version is distinct from excluded.parser_version then null else population.data_sources.last_error end,
             updated_at=now()`,
          [source.id, source.name, source.institution, source.url, source.kind, source.parserType, source.parserVersion,
            source.checkIntervalSeconds, source.enabled, source.autoPublish, source.enabled ? 'pending' : 'disabled', config, source.initialDelaySeconds],
        )
      }
      const count = await client.query('select count(*)::int as count from population.data_versions')
      if (count.rows[0].count === 0) await this.#seedVersions(client, bootstrap, sources, definitions)
      await client.query(`update population.staging_records sr set quality_status='verified'
        where quality_status in ('pending','review_required') and exists (
          select 1 from population.data_versions dv
          where dv.parser_run_id=sr.parser_run_id and dv.status='published'
        )`)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async #seedVersions(client, bootstrap, sources, definitions) {
    const sourceMap = new Map(sources.map((source) => [source.id, source]))
    const definitionMap = new Map(definitions.map((definition) => [definition.code, definition]))
    const collectedAt = nowIso()
    for (const seed of bootstrap.versions) {
      const versionId = makeId()
      const source = sourceMap.get(seed.sourceId)
      await client.query(
        `insert into population.data_versions(
           id,version_code,dataset_key,period,status,quality_status,record_count,change_summary,created_by,created_at,published_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,'bootstrap',$9,$9)`,
        [versionId, seed.versionCode, seed.datasetKey, seed.period, seed.status, seed.qualityStatus, seed.records.length, { bootstrap: true }, seed.publishedAt],
      )
      for (const [indicatorCode, value, unit] of seed.records) {
        const definition = definitionMap.get(indicatorCode)
        await client.query(
          `insert into population.indicator_records(
             version_id,indicator_code,region_code,period,value,unit,frequency,source_id,source_url,
             source_published_at,collected_at,effective_at,platform_published_at,data_status,parser_version,quality_status,dimensions
           ) values($1,$2,'CN',$3,$4,$5,$6,$7,$8,$9,$10,$11,$9,$12,$13,$14,$15)`,
          [versionId, indicatorCode, seed.period, value, unit, definition.frequency, source.id, source.url,
            seed.publishedAt, collectedAt, source.effectiveAt, source.dataStatus, `${source.parserVersion}-bootstrap`, seed.qualityStatus, { bootstrap: true }],
        )
      }
    }
  }

  async listSources() { return (await this.pool.query('select * from population.data_sources order by id')).rows.map(sourceFromRow) }
  async getSource(id) { const result = await this.pool.query('select * from population.data_sources where id=$1', [id]); return result.rows[0] ? sourceFromRow(result.rows[0]) : null }
  async listDefinitions() { return (await this.pool.query('select * from population.indicator_definitions order by code')).rows.map((row) => mapRow(row, ['minimumValue', 'maximumValue', 'reviewChangeRatio'])) }
  async listRegions() { return (await this.pool.query('select code,name,level,parent_code from population.regions where active=true order by code')).rows.map((row) => mapRow(row)) }

  async updateSource(id, patch) {
    const columns = {
      status: 'status', etag: 'etag', lastModified: 'last_modified', lastContentHash: 'last_content_hash',
      lastCheckedAt: 'last_checked_at', lastSuccessAt: 'last_success_at', nextCheckAt: 'next_check_at',
      consecutiveFailures: 'consecutive_failures', lastError: 'last_error',
    }
    const entries = Object.entries(patch).filter(([key]) => columns[key])
    if (!entries.length) return this.getSource(id)
    const values = entries.map(([, value]) => value)
    const assignments = entries.map(([key], index) => `${columns[key]}=$${index + 2}`).join(',')
    const result = await this.pool.query(`update population.data_sources set ${assignments},updated_at=now() where id=$1 returning *`, [id, ...values])
    if (!result.rows[0]) throw new Error(`Unknown source: ${id}`)
    return sourceFromRow(result.rows[0])
  }

  async enqueueDueSources(at = nowIso()) {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const sources = await client.query(
        `select id,check_interval_seconds from population.data_sources
         where enabled=true and next_check_at <= $1
         for update skip locked`, [at],
      )
      const jobs = []
      for (const source of sources.rows) {
        const result = await client.query(
          `insert into population.collection_jobs(source_id,status,available_at)
           select $1,'pending',$2
           where not exists (
             select 1 from population.collection_jobs where source_id=$1 and status in ('pending','retry','processing')
           ) returning *`, [source.id, at],
        )
        if (result.rows[0]) jobs.push(mapRow(result.rows[0], ['priority', 'attempts', 'maxAttempts']))
        await client.query('update population.data_sources set next_check_at=$2::timestamptz + make_interval(secs=>$3) where id=$1', [source.id, at, source.check_interval_seconds])
      }
      await client.query('commit')
      return jobs
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally { client.release() }
  }

  async enqueueSource(sourceId, { priority = 10 } = {}) {
    const result = await this.pool.query(
      `insert into population.collection_jobs(source_id,status,priority)
       select $1,'pending',$2 where exists(select 1 from population.data_sources where id=$1)
       and not exists(select 1 from population.collection_jobs where source_id=$1 and status in ('pending','retry','processing'))
       returning *`, [sourceId, priority],
    )
    if (result.rows[0]) return mapRow(result.rows[0], ['priority', 'attempts', 'maxAttempts'])
    const existing = await this.pool.query(`select * from population.collection_jobs where source_id=$1 and status in ('pending','retry','processing') order by created_at desc limit 1`, [sourceId])
    if (!existing.rows[0]) throw new Error(`Unknown source: ${sourceId}`)
    return mapRow(existing.rows[0], ['priority', 'attempts', 'maxAttempts'])
  }

  async claimJob(workerId) {
    const result = await this.pool.query(
      `update population.collection_jobs set
         status='processing',worker_id=$1,started_at=now(),attempts=attempts+1,updated_at=now()
       where id=(
         select id from population.collection_jobs
         where status in ('pending','retry') and available_at <= now()
         order by priority,available_at,created_at limit 1 for update skip locked
       ) returning *`, [workerId],
    )
    return result.rows[0] ? mapRow(result.rows[0], ['priority', 'attempts', 'maxAttempts']) : null
  }

  async recoverStaleJobs(at = nowIso(), staleMs = 10 * 60 * 1000) {
    const result = await this.pool.query(
      `update population.collection_jobs set
         status=case when attempts >= max_attempts then 'failed' else 'retry' end,
         available_at=$1,
         finished_at=case when attempts >= max_attempts then $1 else null end,
         worker_id=null,last_error='Recovered after worker lease expired',updated_at=$1
       where status='processing' and started_at <= $1::timestamptz - make_interval(secs => $2::int)
       returning *`,
      [at, Math.max(1, Math.floor(staleMs / 1000))],
    )
    return result.rows.map((row) => mapRow(row, ['priority', 'attempts', 'maxAttempts']))
  }

  async completeJob(jobId) { const result = await this.pool.query(`update population.collection_jobs set status='completed',finished_at=now(),updated_at=now() where id=$1 returning *`, [jobId]); return mapRow(result.rows[0], ['priority', 'attempts', 'maxAttempts']) }
  async failJob(jobId, errorMessage) {
    const result = await this.pool.query(
      `update population.collection_jobs set
         status=case when attempts >= max_attempts then 'failed' else 'retry' end,
         available_at=case when attempts >= max_attempts then available_at else now() + make_interval(secs => least(900, 15 * power(2, greatest(0, attempts-1)))::int) end,
         finished_at=case when attempts >= max_attempts then now() else null end,last_error=$2,updated_at=now()
       where id=$1 returning *`, [jobId, errorMessage],
    )
    return mapRow(result.rows[0], ['priority', 'attempts', 'maxAttempts'])
  }

  async recordSourceCheck(input) {
    const id = makeId()
    const result = await this.pool.query(
      `insert into population.source_checks(id,source_id,started_at,finished_at,outcome,http_status,content_hash,duration_ms,error_code,error_message,metadata)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [id,input.sourceId,input.startedAt,input.finishedAt,input.outcome,input.httpStatus,input.contentHash,input.durationMs,input.errorCode,input.errorMessage,input.metadata],
    )
    return mapRow(result.rows[0], ['httpStatus', 'durationMs'])
  }

  async saveRawSnapshot(input) {
    const id = makeId()
    const result = await this.pool.query(
      `insert into population.raw_snapshots(id,source_id,check_id,content_hash,content_type,byte_size,storage_key,response_headers,source_published_at,collected_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict(source_id,content_hash) do nothing returning *`,
      [id,input.sourceId,input.checkId,input.contentHash,input.contentType,input.byteSize,input.storageKey,input.responseHeaders,input.sourcePublishedAt,input.collectedAt],
    )
    if (result.rows[0]) return { snapshot: mapRow(result.rows[0], ['byteSize']), isNew: true }
    const existing = await this.pool.query('select * from population.raw_snapshots where source_id=$1 and content_hash=$2', [input.sourceId,input.contentHash])
    return { snapshot: mapRow(existing.rows[0], ['byteSize']), isNew: false }
  }

  async saveDiscoveredResources({ sourceId, regionCode, snapshotId, discoveredAt = nowIso(), resources }) {
    const client = await this.pool.connect()
    const items = []
    const newItems = []
    const changedItems = []
    const staleItems = []
    try {
      await client.query('begin')
      for (const resource of resources) {
        const existingResult = await client.query(
          'select * from population.discovered_resources where source_id=$1 and resource_url=$2 for update',
          [sourceId, resource.resourceUrl],
        )
        const existing = existingResult.rows[0]
        if (!existing) {
          const created = await client.query(
            `insert into population.discovered_resources(
               id,source_id,region_code,title,resource_url,resource_kind,status,first_seen_at,last_seen_at,last_changed_at,discovered_from_snapshot_id,metadata
             ) values($1,$2,$3,$4,$5,$6,'candidate',$7,$7,$7,$8,$9) returning *`,
            [makeId(), sourceId, regionCode, resource.title, resource.resourceUrl, resource.resourceKind, discoveredAt, snapshotId, resource.metadata ?? {}],
          )
          const item = mapRow(created.rows[0])
          items.push(item)
          newItems.push(item)
          continue
        }
        const previous = mapRow(existing)
        const changed = previous.title !== resource.title
          || previous.resourceKind !== resource.resourceKind
          || previous.status === 'stale'
          || JSON.stringify(previous.metadata ?? {}) !== JSON.stringify(resource.metadata ?? {})
        const updated = await client.query(
          `update population.discovered_resources set
             region_code=$3,title=$4,resource_kind=$5,last_seen_at=$6,
             status=case when status='stale' then 'candidate' else status end,
             last_changed_at=case when $7 then $6 else last_changed_at end,
             discovered_from_snapshot_id=$8,metadata=$9
           where source_id=$1 and resource_url=$2 returning *`,
          [sourceId, resource.resourceUrl, regionCode, resource.title, resource.resourceKind, discoveredAt, changed, snapshotId, resource.metadata ?? {}],
        )
        const item = mapRow(updated.rows[0])
        items.push(item)
        if (changed) changedItems.push(item)
      }
      const seenUrls = resources.map((resource) => resource.resourceUrl)
      const stale = await client.query(
        `update population.discovered_resources set status='stale',last_changed_at=$2
         where source_id=$1 and status='candidate' and not (resource_url=any($3::text[])) returning *`,
        [sourceId, discoveredAt, seenUrls],
      )
      staleItems.push(...stale.rows.map((row) => mapRow(row)))
      await client.query('commit')
      return { items, newItems, changedItems, staleItems }
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async createParserRun(input) {
    const id = makeId()
    const result = await this.pool.query(
      `insert into population.parser_runs(id,raw_snapshot_id,parser_type,parser_version,status,started_at)
       values($1,$2,$3,$4,'running',now()) returning *`, [id,input.rawSnapshotId,input.parserType,input.parserVersion],
    )
    return mapRow(result.rows[0], ['recordCount'])
  }
  async finishParserRun(id, patch) {
    const result = await this.pool.query(
      `update population.parser_runs set status=$2,record_count=coalesce($3,record_count),error_message=$4,finished_at=now() where id=$1 returning *`,
      [id,patch.status,patch.recordCount ?? null,patch.errorMessage ?? null],
    )
    return mapRow(result.rows[0], ['recordCount'])
  }

  async saveStagingRecords(parserRunId, records) {
    const client = await this.pool.connect()
    const created = []
    try {
      await client.query('begin')
      for (const record of records) {
        const id = makeId()
        const result = await client.query(
          `insert into population.staging_records(
             id,parser_run_id,indicator_code,region_code,period,value,unit,frequency,source_id,source_url,source_published_at,collected_at,effective_at,parser_version,quality_status,dimensions,raw_value
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
          [id,parserRunId,record.indicatorCode,record.regionCode,record.period,record.value,record.unit,record.frequency,record.sourceId,record.sourceUrl,
            record.sourcePublishedAt,record.collectedAt,record.effectiveAt,record.parserVersion,record.qualityStatus,record.dimensions,record.rawValue],
        )
        created.push({ ...recordFromRow(result.rows[0]), indicatorName: record.indicatorName, regionName: record.regionName, sourceName: record.sourceName, dataStatus: record.dataStatus })
      }
      await client.query('commit')
      return created
    } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
  }

  async saveValidationIssues(issues) {
    if (!issues.length) return []
    const created = []
    for (const issue of issues) {
      const result = await this.pool.query(
        `insert into population.validation_issues(parser_run_id,staging_record_id,severity,rule_code,message,details)
         values($1,$2,$3,$4,$5,$6) returning *`,
        [issue.parserRunId,issue.stagingRecordId,issue.severity,issue.ruleCode,issue.message,issue.details],
      )
      created.push(mapRow(result.rows[0]))
    }
    return created
  }
  async updateStagingStatuses(statusById) {
    const updated = []
    for (const [id,status] of Object.entries(statusById)) {
      const result = await this.pool.query('update population.staging_records set quality_status=$2 where id=$1 returning *', [id,status])
      if (result.rows[0]) updated.push(recordFromRow(result.rows[0]))
    }
    return updated
  }
  async getStagingRun(parserRunId) {
    const result = await this.pool.query(
      `select sr.*,ide.name as indicator_name,r.name as region_name,ds.name as source_name,ds.config->>'dataStatus' as data_status
       from population.staging_records sr join population.indicator_definitions ide on ide.code=sr.indicator_code
       join population.regions r on r.code=sr.region_code join population.data_sources ds on ds.id=sr.source_id
       where sr.parser_run_id=$1 order by sr.indicator_code`, [parserRunId],
    )
    return result.rows.map(recordFromRow)
  }

  async getLatestRecord(indicatorCode, regionCode, { excludeVersionId = null } = {}) {
    const result = await this.pool.query(
      `select ir.*,ide.name as indicator_name,r.name as region_name,ds.name as source_name
       from population.current_indicator_records ir join population.indicator_definitions ide on ide.code=ir.indicator_code
       join population.regions r on r.code=ir.region_code join population.data_sources ds on ds.id=ir.source_id
       where ir.indicator_code=$1 and ir.region_code=$2 and ($3::uuid is null or ir.version_id <> $3)
       order by ir.effective_at desc limit 1`, [indicatorCode,regionCode,excludeVersionId],
    )
    return result.rows[0] ? recordFromRow(result.rows[0]) : null
  }

  async publishVersion({ version, records, events }) {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const duplicate = await client.query('select * from population.data_versions where version_code=$1', [version.versionCode])
      if (duplicate.rows[0]) { await client.query('rollback'); return { version: mapRow(duplicate.rows[0]), records: [], events: [] } }
      const current = await client.query(
        `update population.data_versions set status='rolled_back',rolled_back_at=$3
         where dataset_key=$1 and period=$2 and status='published' returning id`, [version.datasetKey,version.period,version.publishedAt],
      )
      version.replacesVersionId = current.rows[0]?.id ?? null
      await client.query(
        `insert into population.data_versions(id,version_code,dataset_key,period,status,quality_status,parser_run_id,replaces_version_id,record_count,change_summary,created_by,created_at,published_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [version.id,version.versionCode,version.datasetKey,version.period,version.status,version.qualityStatus,version.parserRunId,version.replacesVersionId,
          version.recordCount,version.changeSummary,version.createdBy,version.createdAt,version.publishedAt],
      )
      for (const record of records) {
        await client.query(
          `insert into population.indicator_records(
             id,version_id,indicator_code,region_code,period,value,unit,frequency,source_id,source_url,source_published_at,collected_at,effective_at,platform_published_at,data_status,parser_version,quality_status,dimensions,created_at
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [record.id,record.versionId,record.indicatorCode,record.regionCode,record.period,record.value,record.unit,record.frequency,record.sourceId,record.sourceUrl,
            record.sourcePublishedAt,record.collectedAt,record.effectiveAt,record.platformPublishedAt,record.dataStatus,record.parserVersion,record.qualityStatus,record.dimensions,record.createdAt],
        )
      }
      for (const event of events) await this.#insertEvent(client, event)
      await client.query(`update population.staging_records set quality_status='verified' where parser_run_id=$1`, [version.parserRunId])
      await client.query('commit')
      return { version, records, events }
    } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
  }

  async #insertEvent(client, event) {
    await client.query(
      `insert into population.publication_events(
         id,event_type,occurred_at,region_code,indicator_code,previous_value,current_value,unit,source_id,source_name,source_url,trigger_rule,version_id,version_code,severity,details,created_at
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [event.id,event.eventType,event.occurredAt,event.regionCode,event.indicatorCode,event.previousValue,event.currentValue,event.unit,event.sourceId,event.sourceName,
        event.sourceUrl,event.triggerRule,event.versionId,event.versionCode,event.severity,event.details,event.createdAt],
    )
  }
  async appendEvents(events) { for (const event of events) await this.#insertEvent(this.pool, event); return events }

  async rollbackVersion(versionId, actor = 'system') {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const current = await client.query(`select * from population.data_versions where id=$1 and status='published' for update`, [versionId])
      if (!current.rows[0]) throw new Error('Only a published version can be rolled back')
      const previous = await client.query(`select * from population.data_versions where id=$1 for update`, [current.rows[0].replaces_version_id])
      if (!previous.rows[0]) throw new Error('No previous version is available')
      const at = nowIso()
      await client.query(`update population.data_versions set status='rolled_back',rolled_back_at=$2 where id=$1`, [versionId,at])
      await client.query(`update population.data_versions set status='published',rolled_back_at=null where id=$1`, [previous.rows[0].id])
      const event = { id:makeId(),eventType:'version.rolled_back',occurredAt:at,regionCode:null,regionName:'全国',indicatorCode:null,indicatorName:'数据版本',previousValue:null,currentValue:null,unit:null,sourceId:null,sourceName:null,sourceUrl:null,triggerRule:'管理员回滚',versionId:previous.rows[0].id,versionCode:previous.rows[0].version_code,severity:'warning',details:{rolledBackVersion:current.rows[0].version_code,actor},createdAt:at }
      await this.#insertEvent(client,event)
      await client.query('commit')
      return { activeVersion: mapRow(previous.rows[0]), event }
    } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
  }

  async getSnapshot() {
    const [records, versions, status] = await Promise.all([
      this.pool.query(
        `select distinct on (ir.indicator_code,ir.region_code) ir.*,ide.name as indicator_name,r.name as region_name,ds.name as source_name
         from population.current_indicator_records ir join population.indicator_definitions ide on ide.code=ir.indicator_code
         join population.regions r on r.code=ir.region_code join population.data_sources ds on ds.id=ir.source_id
         order by ir.indicator_code,ir.region_code,ir.effective_at desc,ir.platform_published_at desc`,
      ),
      this.pool.query(`select * from population.data_versions where status='published' order by published_at desc`),
      this.getStatus(),
    ])
    return { generatedAt: nowIso(), versions: versions.rows.map((row) => mapRow(row)), records: records.rows.map(recordFromRow), status }
  }
  async getIndicatorHistory(indicatorCode, regionCode='CN') {
    const allRegions = regionCode === 'all'
    const result = await this.pool.query(
      `select ir.*,dv.status as version_status,ide.name as indicator_name,r.name as region_name,ds.name as source_name
       from population.indicator_records ir join population.data_versions dv on dv.id=ir.version_id
       join population.indicator_definitions ide on ide.code=ir.indicator_code join population.regions r on r.code=ir.region_code
       join population.data_sources ds on ds.id=ir.source_id
       where ir.indicator_code=$1 and ($3::boolean or ir.region_code=$2) and (not $3::boolean or dv.status='published')
       order by ir.effective_at desc,ir.region_code`, [indicatorCode,regionCode,allRegions],
    )
    return result.rows.map(recordFromRow)
  }
  async getRegion(code) { const region = await this.pool.query(`select code,name,level,parent_code from population.regions where code=$1`,[code]); if(!region.rows[0]) return null; const snapshot=await this.getSnapshot(); return {...mapRow(region.rows[0]),records:snapshot.records.filter((record)=>record.regionCode===code)} }
  async listEvents(limit=50) { const result=await this.pool.query(`select pe.*,r.name as region_name,ide.name as indicator_name from population.publication_events pe left join population.regions r on r.code=pe.region_code left join population.indicator_definitions ide on ide.code=pe.indicator_code order by occurred_at desc limit $1`,[limit]); return result.rows.map(eventFromRow) }
  async listVersions(limit=50) { return (await this.pool.query(`select * from population.data_versions order by created_at desc limit $1`,[limit])).rows.map((row) => mapRow(row)) }
  async listValidationIssues(limit=100) { return (await this.pool.query(`select * from population.validation_issues order by created_at desc limit $1`,[limit])).rows.map((row) => mapRow(row)) }
  async listDiscoveries(limit = 100, filters = {}) {
    const result = await this.pool.query(
      `select dr.*,ds.name as source_name,r.name as region_name
       from population.discovered_resources dr
       join population.data_sources ds on ds.id=dr.source_id
       left join population.regions r on r.code=dr.region_code
       where ($2::text is null or dr.source_id=$2)
         and ($3::text is null or dr.region_code=$3)
         and ($4::text is null or dr.status=$4)
       order by dr.last_seen_at desc limit $1`,
      [limit, filters.sourceId ?? null, filters.regionCode ?? null, filters.status ?? null],
    )
    return result.rows.map((row) => mapRow(row))
  }

  async listReviewRuns(limit = 50) {
    const result = await this.pool.query(
      `select pr.id as parser_run_id,pr.parser_type,pr.parser_version,pr.status as parser_status,pr.started_at,pr.finished_at,
         ds.id as source_id,ds.name as source_name,ds.url as source_url,ds.config->>'datasetKey' as dataset_key,
         ds.config->>'period' as period,rs.content_hash,rs.collected_at,
         count(distinct sr.id)::int as record_count,
         count(distinct sr.id) filter(where sr.quality_status in ('pending','review_required'))::int as pending_count,
         count(distinct vi.id)::int as issue_count,
         count(distinct vi.id) filter(where vi.severity in ('blocking','error'))::int as blocking_issue_count
       from population.parser_runs pr
       join population.raw_snapshots rs on rs.id=pr.raw_snapshot_id
       join population.data_sources ds on ds.id=rs.source_id
       join population.staging_records sr on sr.parser_run_id=pr.id
       left join population.validation_issues vi on vi.parser_run_id=pr.id
       group by pr.id,ds.id,rs.id
       having count(distinct sr.id) filter(where sr.quality_status in ('pending','review_required')) > 0
       order by pr.finished_at desc nulls last
       limit $1`,
      [limit],
    )
    return result.rows.map((row) => mapRow(row, ['recordCount', 'pendingCount', 'issueCount', 'blockingIssueCount']))
  }

  async getReviewRun(parserRunId) {
    const runResult = await this.pool.query(
      `select pr.*,rs.id as snapshot_id,rs.content_hash,rs.content_type,rs.byte_size,rs.source_published_at as snapshot_source_published_at,
         rs.collected_at as snapshot_collected_at,ds.id as source_id,ds.name as source_name,ds.institution,ds.url as source_url,
         ds.config->>'datasetKey' as dataset_key,ds.config->>'period' as source_period
       from population.parser_runs pr join population.raw_snapshots rs on rs.id=pr.raw_snapshot_id
       join population.data_sources ds on ds.id=rs.source_id where pr.id=$1`,
      [parserRunId],
    )
    if (!runResult.rows[0]) return null
    const row = mapRow(runResult.rows[0], ['recordCount', 'byteSize'])
    const [records, issues] = await Promise.all([
      this.getStagingRun(parserRunId),
      this.pool.query(`select * from population.validation_issues where parser_run_id=$1 order by created_at`, [parserRunId]),
    ])
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
    return {
      parserRun: {
        id: row.id,
        parserType: row.parserType,
        parserVersion: row.parserVersion,
        status: row.status,
        recordCount: row.recordCount,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        errorMessage: row.errorMessage,
      },
      source: {
        id: row.sourceId,
        name: row.sourceName,
        institution: row.institution,
        url: row.sourceUrl,
        datasetKey: row.datasetKey,
        period: row.sourcePeriod,
      },
      rawSnapshot: {
        id: row.snapshotId,
        contentHash: row.contentHash,
        contentType: row.contentType,
        byteSize: row.byteSize,
        sourcePublishedAt: row.snapshotSourcePublishedAt,
        collectedAt: row.snapshotCollectedAt,
      },
      records: comparedRecords,
      issues: issues.rows.map((item) => mapRow(item)),
    }
  }

  async getStatus() {
    const result = await this.pool.query(
      `select
         count(*)::int as total_sources,
         count(*) filter(where status='healthy')::int as online_sources,
         count(*) filter(where coalesce(config->>'role','dataset') <> 'portal')::int as dataset_sources,
         count(*) filter(where coalesce(config->>'role','dataset') <> 'portal' and status='healthy')::int as online_dataset_sources,
         count(*) filter(where config->>'role'='portal')::int as portal_sources,
         count(*) filter(where config->>'role'='portal' and status='healthy')::int as online_portal_sources,
         count(*) filter(where status='delayed')::int as delayed_sources,
         count(*) filter(where status='failed')::int as failed_sources,
         (select count(*)::int from population.discovered_resources where status='candidate') as discovered_resources,
         (select count(*)::int from population.staging_records where quality_status in ('pending','review_required')) as pending_validation,
         (select count(*)::int from population.data_versions where status='published') as published_versions,
         (select max(finished_at) from population.source_checks) as last_check_at,
         (select version_code from population.data_versions where status='published' order by published_at desc limit 1) as latest_version,
         (select count(*)::int from population.collection_jobs where status in ('pending','retry')) as pending_jobs,
         (select count(*)::int from population.collection_jobs where status='processing') as processing_jobs,
         (select count(*)::int from population.collection_jobs where status='failed') as failed_jobs
       from population.data_sources`,
    )
    const row = mapRow(result.rows[0])
    return { storage:'postgres',connection:'connected',totalSources:row.totalSources,onlineSources:row.onlineSources,datasetSources:row.datasetSources,onlineDatasetSources:row.onlineDatasetSources,portalSources:row.portalSources,onlinePortalSources:row.onlinePortalSources,delayedSources:row.delayedSources,failedSources:row.failedSources,discoveredResources:row.discoveredResources,pendingValidation:row.pendingValidation,publishedVersions:row.publishedVersions,lastCheckAt:row.lastCheckAt,latestVersion:row.latestVersion,jobs:{pending:row.pendingJobs,processing:row.processingJobs,failed:row.failedJobs} }
  }

  async close() { await this.pool.end() }
}
