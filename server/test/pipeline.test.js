import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { FileRepository } from '../src/storage/file-repository.js'
import { RawStorage } from '../src/collection/raw-storage.js'
import { HttpCollector } from '../src/collection/http-collector.js'
import { IndicatorValidator } from '../src/validation/indicator-validator.js'
import { VersionPublisher } from '../src/publishing/publisher.js'
import { CollectionPipeline } from '../src/pipeline.js'
import { RealtimeEventBus } from '../src/realtime/event-bus.js'
import { StructuredLogger } from '../src/monitoring/logger.js'
import { bulletinHtml } from './fixtures.js'

const portalHtml = `<!doctype html><html><body>
  <a href="/reports/2025-statistical-bulletin.html">2025年国民经济和社会发展统计公报</a>
  <a href="/downloads/resident-population.xlsx">常住人口统计表</a>
  <a href="/downloads/sample-survey.pdf">人口抽样调查主要数据</a>
  <a href="/notices/meeting.pdf">一般会议通知</a>
  <a href="javascript:void(0)">栏目菜单</a>
</body></html>`

let server
let baseUrl
before(async () => {
  server = http.createServer((request, response) => {
    if (request.headers['if-none-match'] === '"fixture-v1"') {
      response.writeHead(304, { etag: '"fixture-v1"' })
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: '"fixture-v1"' })
    response.end(request.url === '/portal' ? portalHtml : bulletinHtml)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/bulletin`
})
after(() => new Promise((resolve) => server.close(resolve)))

test('采集→原始存档→解析→校验→审核发布→重复内容不重发', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-pipeline-'))
  const repository = await new FileRepository({
    directory: path.join(directory, 'data'),
    sourcesPath: path.resolve('data/sources.json'),
    bootstrapPath: path.resolve('data/bootstrap.json'),
  }).init()
  const sourceId = 'nbs-2025-national-bulletin'
  await repository.updateSource(sourceId, { url: baseUrl, etag: null, lastContentHash: null })
  const eventBus = new RealtimeEventBus()
  const receivedEvents = []
  eventBus.on('event', (event) => receivedEvents.push(event))
  const logger = new StructuredLogger({ directory: path.join(directory, 'logs'), stream: { write() {} } })
  const collector = new HttpCollector({ repository, rawStorage: new RawStorage(path.join(directory, 'raw')), logger })
  const validator = new IndicatorValidator({ repository })
  const publisher = new VersionPublisher({ repository, eventBus, logger })
  const pipeline = new CollectionPipeline({ repository, collector, validator, publisher, eventBus, logger })

  const first = await pipeline.processSource(sourceId)
  assert.equal(first.outcome, 'review_required')
  assert.equal(first.validation.rejected, false)
  const reviewRuns = await repository.listReviewRuns()
  assert.equal(reviewRuns.length, 1)
  assert.equal(reviewRuns[0].parserRunId, first.parserRunId)
  assert.equal(reviewRuns[0].pendingCount, 16)
  const reviewDetail = await repository.getReviewRun(first.parserRunId)
  assert.equal(reviewDetail.rawSnapshot.contentHash.length, 64)
  assert.equal(reviewDetail.records.length, 16)
  assert.equal(reviewDetail.records.find((record) => record.indicatorCode === 'population_total').previousValue, 140489)
  const published = await publisher.publishParserRun(first.parserRunId, { actor: 'test-reviewer', approved: true })
  assert.equal(published.version.status, 'published')
  assert.equal(published.records.length, 16)
  assert.equal((await repository.getStatus()).pendingValidation, 0)
  assert.deepEqual(await repository.listReviewRuns(), [])
  assert.ok(receivedEvents.some((event) => event.eventType === 'version.published'))

  const second = await pipeline.processSource(sourceId)
  assert.equal(second.outcome, 'unchanged')
  const rawFiles = (await fs.readdir(path.join(directory, 'raw'), { recursive: true })).filter((name) => name.endsWith('.html'))
  assert.equal(rawFiles.length, 1)
})

test('省级统计门户只保存变更快照和发现事件，不生成指标或正式版本', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-portal-monitor-'))
  const repository = await new FileRepository({
    directory: path.join(directory, 'data'),
    sourcesPath: path.resolve('data/sources.json'),
    bootstrapPath: path.resolve('data/bootstrap.json'),
  }).init()
  const sourceId = 'province-portal-110000'
  await repository.updateSource(sourceId, { url: new URL('/portal', baseUrl).toString(), etag: null, lastContentHash: null })
  const eventBus = new RealtimeEventBus()
  const receivedEvents = []
  eventBus.on('event', (event) => receivedEvents.push(event))
  const logger = new StructuredLogger({ directory: path.join(directory, 'logs'), stream: { write() {} } })
  const collector = new HttpCollector({ repository, rawStorage: new RawStorage(path.join(directory, 'raw')), logger })
  const publisher = new VersionPublisher({ repository, eventBus, logger })
  const pipeline = new CollectionPipeline({
    repository,
    collector,
    validator: new IndicatorValidator({ repository }),
    publisher,
    eventBus,
    logger,
  })

  const first = await pipeline.processSource(sourceId)
  assert.equal(first.outcome, 'monitored_change')
  assert.equal(first.discoveredResources, 3)
  assert.equal(first.newDiscoveries, 3)
  assert.deepEqual(await repository.listReviewRuns(), [])
  const discoveries = await repository.listDiscoveries(10, { sourceId })
  assert.equal(discoveries.length, 3)
  assert.deepEqual(new Set(discoveries.map((item) => item.resourceKind)), new Set(['html', 'xlsx', 'pdf']))
  assert.ok(receivedEvents.some((event) => event.eventType === 'source.changed' && event.regionCode === '110000'))
  assert.ok(receivedEvents.some((event) => event.eventType === 'source.discovery' && event.regionCode === '110000'))
  assert.equal((await repository.listVersions()).length, 2)

  const rescan = await repository.saveDiscoveredResources({
    sourceId,
    regionCode: '110000',
    snapshotId: null,
    discoveredAt: new Date(Date.now() + 1000).toISOString(),
    resources: [{
      title: discoveries[0].title,
      resourceUrl: discoveries[0].resourceUrl,
      resourceKind: discoveries[0].resourceKind,
      metadata: discoveries[0].metadata,
    }],
  })
  assert.equal(rescan.staleItems.length, 2)
  assert.equal((await repository.listDiscoveries(10, { sourceId, status: 'candidate' })).length, 1)

  const second = await pipeline.processSource(sourceId)
  assert.equal(second.outcome, 'unchanged')
  assert.ok(receivedEvents.some((event) => event.eventType === 'source.checked'))
  const rawFiles = (await fs.readdir(path.join(directory, 'raw'), { recursive: true })).filter((name) => name.endsWith('.html'))
  assert.equal(rawFiles.length, 1)
})

test('发现规则升级后可对304门户执行一次无条件候选回填', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-portal-backfill-'))
  const repository = await new FileRepository({
    directory: path.join(directory, 'data'),
    sourcesPath: path.resolve('data/sources.json'),
    bootstrapPath: path.resolve('data/bootstrap.json'),
  }).init()
  const sourceId = 'province-portal-120000'
  await repository.updateSource(sourceId, {
    url: new URL('/portal', baseUrl).toString(),
    etag: '"fixture-v1"',
    lastContentHash: createHash('sha256').update(Buffer.from(portalHtml)).digest('hex'),
  })
  const eventBus = new RealtimeEventBus()
  const logger = new StructuredLogger({ directory: path.join(directory, 'logs'), stream: { write() {} } })
  const collector = new HttpCollector({ repository, rawStorage: new RawStorage(path.join(directory, 'raw')), logger })
  const pipeline = new CollectionPipeline({
    repository,
    collector,
    validator: new IndicatorValidator({ repository }),
    publisher: new VersionPublisher({ repository, eventBus, logger }),
    eventBus,
    logger,
  })

  const result = await pipeline.processSource(sourceId, { forceDiscovery: true })
  assert.equal(result.outcome, 'unchanged')
  assert.equal(result.discoveredResources, 3)
  assert.equal(result.newDiscoveries, 3)
  assert.equal((await repository.listDiscoveries(10, { sourceId })).length, 3)
})

test('逻辑关系异常会阻止正式发布', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-validation-'))
  const repository = await new FileRepository({
    directory: path.join(directory, 'data'),
    sourcesPath: path.resolve('data/sources.json'),
    bootstrapPath: path.resolve('data/bootstrap.json'),
  }).init()
  const source = await repository.getSource('nbs-2025-national-bulletin')
  const parserRun = await repository.createParserRun({ rawSnapshotId: 'fixture', parserType: source.parserType, parserVersion: source.parserVersion })
  const template = {
    indicatorName: '测试', regionCode: 'CN', regionName: '全国', period: '2026', unit: '万人', frequency: 'annual',
    sourceId: source.id, sourceName: source.name, sourceUrl: source.url, sourcePublishedAt: source.sourcePublishedAt,
    collectedAt: new Date().toISOString(), effectiveAt: '2026-12-31T23:59:59+08:00', dataStatus: 'official', parserVersion: source.parserVersion,
    qualityStatus: 'pending', dimensions: {},
  }
  const staging = await repository.saveStagingRecords(parserRun.id, [
    { ...template, indicatorCode: 'population_total', value: 140000 },
    { ...template, indicatorCode: 'urban_population', value: 95000 },
    { ...template, indicatorCode: 'rural_population', value: 1000 },
  ])
  const validation = await new IndicatorValidator({ repository }).validate(parserRun.id, staging, source)
  assert.equal(validation.rejected, true)
  assert.ok(validation.issues.some((item) => item.ruleCode === 'urban_rural_total' && item.severity === 'blocking'))
})
