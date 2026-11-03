import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { IndicatorValidator } from '../src/validation/indicator-validator.js'
import { VersionPublisher } from '../src/publishing/publisher.js'
import { PostgresRepository } from '../src/storage/postgres-repository.js'
import { PortablePostgres } from './portable-postgres.js'

const projectRoot = path.resolve(import.meta.dirname, '..', '..')

const getFreePort = async () => {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

test('PostgreSQL 17 迁移、权限、种子数据与并发作业领取契约', { timeout: 120_000 }, async () => {
  const port = await getFreePort()
  const databaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'population-postgres-'))
  const password = 'local-integration-test-only'
  const embedded = new PortablePostgres({
    rootDir: databaseDir,
    user: 'postgres',
    password,
    port,
  })
  let repository

  try {
    await embedded.initialise()
    await embedded.start()
    await embedded.createDatabase('population_test')

    const migrationClient = embedded.getClient('population_test')
    await migrationClient.connect()
    try {
      for (const migration of ['001_initial.sql', '002_roles.sql', '003_operational_hardening.sql', '004_source_discovery.sql', '005_document_source_kind.sql']) {
        const sql = await fs.readFile(path.join(projectRoot, 'database', 'migrations', migration), 'utf8')
        await migrationClient.query(sql)
      }

      const schema = await migrationClient.query(
        `select
           to_regclass('population.data_sources') as sources_table,
           to_regclass('population.discovered_resources') as discoveries_table,
           to_regclass('population.current_indicator_records') as current_view,
           has_table_privilege('population_api_readonly','population.indicator_records','select') as api_can_select,
           has_table_privilege('population_api_readonly','population.indicator_records','insert') as api_can_insert,
           has_table_privilege('population_pipeline_writer','population.indicator_records','insert') as writer_can_insert,
           has_table_privilege('population_pipeline_writer','population.indicator_records','delete') as writer_can_delete,
           has_table_privilege('population_api_readonly','population.discovered_resources','select') as api_can_read_discoveries,
           has_table_privilege('population_pipeline_writer','population.discovered_resources','insert') as writer_can_insert_discoveries,
           exists(
             select 1 from pg_constraint
             where conrelid='population.data_sources'::regclass
               and conname='data_sources_kind_check'
               and pg_get_constraintdef(oid) like '%doc%'
           ) as source_kind_accepts_doc`,
      )
      assert.equal(schema.rows[0].sources_table, 'population.data_sources')
      assert.equal(schema.rows[0].discoveries_table, 'population.discovered_resources')
      assert.equal(schema.rows[0].current_view, 'population.current_indicator_records')
      assert.equal(schema.rows[0].api_can_select, true)
      assert.equal(schema.rows[0].api_can_insert, false)
      assert.equal(schema.rows[0].writer_can_insert, true)
      assert.equal(schema.rows[0].writer_can_delete, false)
      assert.equal(schema.rows[0].api_can_read_discoveries, true)
      assert.equal(schema.rows[0].writer_can_insert_discoveries, true)
      assert.equal(schema.rows[0].source_kind_accepts_doc, true)
    } finally {
      await migrationClient.end()
    }

    const connectionString = `postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/population_test`
    repository = new PostgresRepository({
      connectionString,
      sourcesPath: path.join(projectRoot, 'server', 'data', 'sources.json'),
      bootstrapPath: path.join(projectRoot, 'server', 'data', 'bootstrap.json'),
    })
    await repository.init()

    const snapshot = await repository.getSnapshot()
    assert.equal(snapshot.status.storage, 'postgres')
    assert.equal(snapshot.status.totalSources, 66)
    assert.equal(snapshot.status.datasetSources, 35)
    assert.equal(snapshot.status.portalSources, 31)
    assert.equal(snapshot.versions.length, 2)
    assert.equal(snapshot.records.find((record) => record.indicatorCode === 'population_total').value, 140489)
    assert.equal(snapshot.records.find((record) => record.indicatorCode === 'floating_population').period, '2025-11-01')
    assert.equal((await repository.listRegions()).length, 32)
    assert.equal((await repository.listVersions()).length, 2)
    assert.deepEqual(await repository.listReviewRuns(), [])
    assert.equal((await repository.getIndicatorHistory('population_total', 'all'))[0].value, 140489)

    const dueAt = new Date().toISOString()
    const jobs = await repository.enqueueDueSources(dueAt)
    assert.equal(jobs.length, 35)
    const [first, second] = await Promise.all([
      repository.claimJob('postgres-worker-a'),
      repository.claimJob('postgres-worker-b'),
    ])
    assert.ok(first)
    assert.ok(second)
    assert.notEqual(first.id, second.id)

    await repository.completeJob(first.id)
    const retrying = await repository.failJob(second.id, 'integration test failure')
    assert.equal(retrying.status, 'retry')
    assert.ok(new Date(retrying.availableAt) > new Date(retrying.updatedAt))

    const source = await repository.getSource('nbs-2025-national-bulletin')
    const checkedAt = new Date().toISOString()
    const check = await repository.recordSourceCheck({
      sourceId: source.id,
      startedAt: checkedAt,
      finishedAt: checkedAt,
      outcome: 'changed',
      httpStatus: 200,
      contentHash: 'a'.repeat(64),
      durationMs: 12,
      errorCode: null,
      errorMessage: null,
      metadata: { integration: true },
    })
    const saved = await repository.saveRawSnapshot({
      sourceId: source.id,
      checkId: check.id,
      contentHash: 'a'.repeat(64),
      contentType: 'text/html',
      byteSize: 123,
      storageKey: 'integration/raw.html',
      responseHeaders: { etag: 'integration' },
      sourcePublishedAt: source.sourcePublishedAt,
      collectedAt: checkedAt,
    })
    const discovery = await repository.saveDiscoveredResources({
      sourceId: source.id,
      regionCode: 'CN',
      snapshotId: saved.snapshot.id,
      discoveredAt: checkedAt,
      resources: [{
        title: '人口统计公报附件',
        resourceUrl: 'https://example.com/population-report.pdf',
        resourceKind: 'pdf',
        metadata: { integration: true },
      }],
    })
    assert.equal(discovery.newItems.length, 1)
    assert.equal((await repository.listDiscoveries(10, { sourceId: source.id }))[0].resourceKind, 'pdf')
    const staleDiscovery = await repository.saveDiscoveredResources({
      sourceId: source.id,
      regionCode: 'CN',
      snapshotId: saved.snapshot.id,
      discoveredAt: new Date(Date.now() + 1000).toISOString(),
      resources: [],
    })
    assert.equal(staleDiscovery.staleItems.length, 1)
    assert.deepEqual(await repository.listDiscoveries(10, { sourceId: source.id, status: 'candidate' }), [])
    const parserRun = await repository.createParserRun({
      rawSnapshotId: saved.snapshot.id,
      parserType: source.parserType,
      parserVersion: source.parserVersion,
    })
    const revisionInput = snapshot.records
      .filter((record) => record.sourceId === source.id)
      .map((record) => {
        const { id, versionId, platformPublishedAt, createdAt, ...stagingRecord } = record
        return {
          ...stagingRecord,
          value: record.indicatorCode === 'birth_population' ? 900 : record.value,
          qualityStatus: 'pending',
        }
      })
    const staging = await repository.saveStagingRecords(parserRun.id, revisionInput)
    await repository.finishParserRun(parserRun.id, { status: 'succeeded', recordCount: staging.length })
    const validator = new IndicatorValidator({ repository })
    const validation = await validator.validate(parserRun.id, staging, source)
    assert.equal(validation.rejected, false)
    assert.ok(validation.issues.some((issue) => issue.ruleCode === 'change_threshold'))
    assert.equal((await repository.listReviewRuns())[0].parserRunId, parserRun.id)
    assert.equal((await repository.getReviewRun(parserRun.id)).records.length, 16)

    const emitted = []
    const publisher = new VersionPublisher({
      repository,
      eventBus: { publish: (event) => emitted.push(event) },
      logger: { info: async () => {}, warn: async () => {} },
    })
    const published = await publisher.publishParserRun(parserRun.id, { actor: 'postgres-integration-reviewer', approved: true })
    assert.equal((await repository.getSnapshot()).records.find((record) => record.indicatorCode === 'birth_population').value, 900)
    assert.ok(emitted.some((event) => event.eventType === 'version.published'))
    await publisher.rollback(published.version.id, 'postgres-integration-reviewer')
    assert.equal((await repository.getSnapshot()).records.find((record) => record.indicatorCode === 'birth_population').value, 792)

    const failedSource = await repository.updateSource(source.id, { status: 'delayed', lastError: 'integration failure' })
    assert.equal(failedSource.lastError, 'integration failure')
  } finally {
    await repository?.close()
    await embedded.stop().catch(() => {})
    await embedded.cleanup().catch(() => {})
  }
})
