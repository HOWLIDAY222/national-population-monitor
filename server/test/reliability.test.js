import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { HttpCollector } from '../src/collection/http-collector.js'
import { RawStorage } from '../src/collection/raw-storage.js'
import { CollectionPipeline } from '../src/pipeline.js'
import { VersionPublisher } from '../src/publishing/publisher.js'
import { RealtimeEventBus } from '../src/realtime/event-bus.js'
import { FileRepository } from '../src/storage/file-repository.js'
import { IndicatorValidator } from '../src/validation/indicator-validator.js'
import { StructuredLogger } from '../src/monitoring/logger.js'

const createFixture = async (prefix) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const repository = await new FileRepository({
    directory: path.join(directory, 'data'),
    sourcesPath: path.resolve('data/sources.json'),
    bootstrapPath: path.resolve('data/bootstrap.json'),
  }).init()
  const eventBus = new RealtimeEventBus()
  const logger = new StructuredLogger({ directory: path.join(directory, 'logs'), stream: { write() {} } })
  const collector = new HttpCollector({ repository, rawStorage: new RawStorage(path.join(directory, 'raw')), logger })
  const validator = new IndicatorValidator({ repository })
  const publisher = new VersionPublisher({ repository, eventBus, logger })
  const pipeline = new CollectionPipeline({ repository, collector, validator, publisher, eventBus, logger })
  return { directory, repository, eventBus, logger, collector, validator, publisher, pipeline }
}

test('同周期修订超过阈值时需要审核，发布后可回滚到上一正式版本', async () => {
  const { repository, validator, publisher } = await createFixture('population-revision-')
  const source = await repository.getSource('nbs-2025-national-bulletin')
  const snapshot = await repository.getSnapshot()
  const parserRun = await repository.createParserRun({
    rawSnapshotId: 'fixture-revision',
    parserType: source.parserType,
    parserVersion: source.parserVersion,
  })
  const input = snapshot.records
    .filter((record) => record.sourceId === source.id)
    .map((record) => {
      const { id, versionId, platformPublishedAt, createdAt, ...stagingRecord } = record
      return {
        ...stagingRecord,
        value: record.indicatorCode === 'birth_population' ? 900 : record.value,
        qualityStatus: 'pending',
      }
    })
  const staging = await repository.saveStagingRecords(parserRun.id, input)
  const validation = await validator.validate(parserRun.id, staging, source)

  assert.equal(validation.rejected, false)
  assert.ok(validation.issues.some((item) => item.ruleCode === 'change_threshold'
    && item.details.previousPeriod === '2025'
    && item.details.currentValue === 900))

  const published = await publisher.publishParserRun(parserRun.id, { actor: 'reviewer-test', approved: true })
  assert.ok(published.version.replacesVersionId)
  assert.equal((await repository.getSnapshot()).records.find((record) => record.indicatorCode === 'birth_population').value, 900)

  const rolledBack = await publisher.rollback(published.version.id, 'reviewer-test')
  assert.equal(rolledBack.activeVersion.versionCode, 'nbs-2025-year-end-bootstrap-v1')
  assert.equal((await repository.getSnapshot()).records.find((record) => record.indicatorCode === 'birth_population').value, 792)
  assert.ok((await repository.listEvents()).some((event) => event.eventType === 'version.rolled_back'))
})

test('采集失败会记录延迟状态并继续提供上一正式快照', async () => {
  const { repository, pipeline } = await createFixture('population-failure-')
  const failingServer = http.createServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'text/plain' })
    response.end('temporarily unavailable')
  })
  await new Promise((resolve) => failingServer.listen(0, '127.0.0.1', resolve))
  try {
    const sourceId = 'nbs-2025-national-bulletin'
    await repository.updateSource(sourceId, { url: `http://127.0.0.1:${failingServer.address().port}/bulletin` })
    await assert.rejects(() => pipeline.processSource(sourceId), /HTTP 503/)
    const source = await repository.getSource(sourceId)
    const official = (await repository.getSnapshot()).records.find((record) => record.indicatorCode === 'population_total')

    assert.equal(source.status, 'delayed')
    assert.equal(source.consecutiveFailures, 1)
    assert.ok(new Date(source.nextCheckAt) > new Date(source.lastCheckedAt))
    assert.equal(official.value, 140489)
    assert.equal(official.qualityStatus, 'reviewed')
  } finally {
    await new Promise((resolve) => failingServer.close(resolve))
  }
})

test('官方网页结构变化导致解析失败时，原正式版本与失败事件都被保留', async () => {
  const { repository, pipeline } = await createFixture('population-parser-failure-')
  const changedLayoutServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<html><body><main>页面结构已经改变，当前解析器无法识别。</main></body></html>')
  })
  await new Promise((resolve) => changedLayoutServer.listen(0, '127.0.0.1', resolve))
  try {
    const sourceId = 'nbs-2025-national-bulletin'
    await repository.updateSource(sourceId, {
      url: `http://127.0.0.1:${changedLayoutServer.address().port}/changed-layout`,
      etag: null,
      lastContentHash: null,
    })
    await assert.rejects(() => pipeline.processSource(sourceId), /Required field was not found/)
    const official = (await repository.getSnapshot()).records.find((record) => record.indicatorCode === 'population_total')
    const failedSource = await repository.getSource(sourceId)
    assert.equal(official.value, 140489)
    assert.equal(failedSource.status, 'delayed')
    assert.equal(failedSource.lastContentHash, null)
    assert.match(failedSource.lastError, /Parser failed/)
    assert.ok((await repository.listEvents()).some((event) => event.eventType === 'parser.failed'))
  } finally {
    await new Promise((resolve) => changedLayoutServer.close(resolve))
  }
})

test('指标单位发生变化会被阻断，不得通过人工批准绕过', async () => {
  const { repository, validator, publisher } = await createFixture('population-unit-change-')
  const source = await repository.getSource('nbs-2025-national-bulletin')
  const parserRun = await repository.createParserRun({
    rawSnapshotId: 'fixture-unit-change',
    parserType: source.parserType,
    parserVersion: source.parserVersion,
  })
  const staging = await repository.saveStagingRecords(parserRun.id, [{
    indicatorCode: 'population_total', indicatorName: '年末全国人口', regionCode: 'CN', regionName: '全国',
    period: source.period, value: 1404890000, unit: '人', frequency: 'annual', sourceId: source.id,
    sourceName: source.name, sourceUrl: source.url, sourcePublishedAt: source.sourcePublishedAt,
    collectedAt: new Date().toISOString(), effectiveAt: source.effectiveAt, dataStatus: source.dataStatus,
    parserVersion: source.parserVersion, qualityStatus: 'pending', dimensions: {},
  }])
  const validation = await validator.validate(parserRun.id, staging, source)
  assert.equal(validation.rejected, true)
  assert.ok(validation.issues.some((item) => item.ruleCode === 'unit_changed' && item.severity === 'blocking'))
  await assert.rejects(
    () => publisher.publishParserRun(parserRun.id, { actor: 'reviewer-test', approved: true }),
    /Rejected records cannot be published/,
  )
})

test('过期的 processing 作业会恢复为可重试状态', async () => {
  const { repository } = await createFixture('population-stale-job-')
  const sourceId = 'nbs-2025-national-bulletin'
  const job = await repository.enqueueSource(sourceId)
  const claimedAt = new Date().toISOString()
  const claimed = await repository.claimJob('crashed-worker', claimedAt)
  assert.equal(claimed.id, job.id)
  assert.equal(claimed.status, 'processing')

  const recoveryAt = new Date(new Date(claimedAt).getTime() + 60_000).toISOString()
  const recovered = await repository.recoverStaleJobs(recoveryAt, 1_000)
  assert.equal(recovered.length, 1)
  assert.equal(recovered[0].status, 'retry')
  assert.equal(recovered[0].workerId, null)
  assert.match(recovered[0].lastError, /lease expired/)
})

test('来源与指标同时允许自动发布时，已验证记录无需人工批准即可进入正式版本', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-auto-publish-'))
  const sourceServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify([{ indicator: 'live_index', value: 123.4, unit: '点' }]))
  })
  await new Promise((resolve) => sourceServer.listen(0, '127.0.0.1', resolve))
  try {
    const sourcesPath = path.join(directory, 'sources.json')
    const bootstrapPath = path.join(directory, 'bootstrap.json')
    await fs.writeFile(sourcesPath, JSON.stringify([{
      id: 'auto-json-source',
      name: '自动发布测试来源',
      institution: '测试统计机构',
      url: `http://127.0.0.1:${sourceServer.address().port}/data.json`,
      kind: 'json',
      parserType: 'generic-json',
      parserVersion: 'generic-json-v1',
      checkIntervalSeconds: 60,
      enabled: true,
      autoPublish: true,
      datasetKey: 'live-index',
      period: '2026-07-16T20:00:00+08:00',
      effectiveAt: '2026-07-16T20:00:00+08:00',
      sourcePublishedAt: '2026-07-16T20:00:00+08:00',
      dataStatus: 'index',
      request: { timeoutMs: 5000, userAgent: 'PopulationPlatformTest/1.0' },
      parserConfig: {
        columns: { indicatorCode: 'indicator', value: 'value', unit: 'unit' },
      },
    }]), 'utf8')
    await fs.writeFile(bootstrapPath, JSON.stringify({
      regions: [{ code: 'CN', name: '全国', level: 'country', parentCode: null }],
      indicatorDefinitions: [{
        code: 'live_index', name: '实时指数', description: '自动发布测试聚合指数', defaultUnit: '点',
        frequency: 'realtime', valueType: 'index', minimumValue: 0, maximumValue: 1000,
        reviewChangeRatio: 0.2, autoPublish: true,
      }],
      versions: [],
    }), 'utf8')

    const repository = await new FileRepository({
      directory: path.join(directory, 'data'),
      sourcesPath,
      bootstrapPath,
    }).init()
    const eventBus = new RealtimeEventBus()
    const logger = new StructuredLogger({ directory: path.join(directory, 'logs'), stream: { write() {} } })
    const collector = new HttpCollector({ repository, rawStorage: new RawStorage(path.join(directory, 'raw')), logger })
    const validator = new IndicatorValidator({ repository })
    const publisher = new VersionPublisher({ repository, eventBus, logger })
    const pipeline = new CollectionPipeline({ repository, collector, validator, publisher, eventBus, logger })

    const result = await pipeline.processSource('auto-json-source')
    assert.equal(result.outcome, 'published')
    assert.equal(result.validation.canAutoPublish, true)
    assert.equal(result.published.version.qualityStatus, 'verified')
    assert.equal((await repository.getSnapshot()).records[0].value, 123.4)
    assert.equal((await repository.listReviewRuns()).length, 0)
  } finally {
    await new Promise((resolve) => sourceServer.close(resolve))
  }
})
