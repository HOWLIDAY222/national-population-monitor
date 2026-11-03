import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createApplication } from '../src/application.js'
import { loadConfig } from '../src/config.js'

test('查询API返回官方启动版本，管理API默认关闭，SSE建立连接', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-api-'))
  const config = loadConfig({
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', STORAGE_DRIVER: 'file', SCHEDULER_ENABLED: 'false',
    FILE_DATA_DIR: path.join(directory, 'data'), RAW_STORAGE_DIR: path.join(directory, 'raw'), MONITORING_DIR: path.join(directory, 'logs'),
    SOURCES_PATH: path.resolve('data/sources.json'), BOOTSTRAP_PATH: path.resolve('data/bootstrap.json'), SSE_HEARTBEAT_MS: '5000',
  })
  const configuredSources = JSON.parse(await fs.readFile(config.sourcesPath, 'utf8'))
  const application = await createApplication(config)
  const address = await application.start()
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const health = await fetch(`${origin}/api/health`).then((response) => response.json())
    assert.equal(health.ok, true)
    assert.equal(health.status.publishedVersions, 2)
    const snapshot = await fetch(`${origin}/api/v1/snapshot`).then((response) => response.json())
    assert.ok(snapshot.records.some((record) => record.indicatorCode === 'population_total' && record.value === 140489))
    const reviewRuns = await fetch(`${origin}/api/v1/review-runs`).then((response) => response.json())
    assert.deepEqual(reviewRuns.items, [])
    const [status, sources, versions, events, discoveries, history, allHistory, region] = await Promise.all([
      fetch(`${origin}/api/v1/status`).then((response) => response.json()),
      fetch(`${origin}/api/v1/sources`).then((response) => response.json()),
      fetch(`${origin}/api/v1/versions`).then((response) => response.json()),
      fetch(`${origin}/api/v1/events`).then((response) => response.json()),
      fetch(`${origin}/api/v1/discoveries`).then((response) => response.json()),
      fetch(`${origin}/api/v1/indicators/population_total/history?regionCode=CN`).then((response) => response.json()),
      fetch(`${origin}/api/v1/indicators/population_total/history?regionCode=all`).then((response) => response.json()),
      fetch(`${origin}/api/v1/regions/CN`).then((response) => response.json()),
    ])
    assert.equal(status.totalSources, configuredSources.length)
    assert.equal(status.datasetSources, configuredSources.filter((source) => source.role !== 'portal').length)
    assert.equal(status.portalSources, 31)
    assert.equal(sources.items.length, configuredSources.length)
    assert.equal(versions.items.length, 2)
    assert.equal(events.items.length, 2)
    assert.deepEqual(discoveries.items, [])
    assert.equal(history.items[0].value, 140489)
    assert.equal(allHistory.items[0].value, 140489)
    assert.ok(region.records.some((record) => record.indicatorCode === 'floating_population'))
    assert.equal((await fetch(`${origin}/api/v1/regions/UNKNOWN`)).status, 404)
    const disabled = await fetch(`${origin}/api/v1/admin/sources/nbs-2025-national-bulletin/collect`, { method: 'POST' })
    assert.equal(disabled.status, 503)

    const controller = new AbortController()
    const streamResponse = await fetch(`${origin}/api/v1/stream`, { signal: controller.signal })
    const reader = streamResponse.body.getReader()
    const firstChunk = await reader.read()
    assert.match(new TextDecoder().decode(firstChunk.value), /event: connected/)
    application.eventBus.publish({
      id: 'test-sse-event',
      eventType: 'indicator.updated',
      indicatorCode: 'population_total',
      currentValue: 140489,
    })
    const updateChunk = await reader.read()
    controller.abort()
    const updateMessage = new TextDecoder().decode(updateChunk.value)
    assert.match(updateMessage, /event: indicator.updated/)
    assert.match(updateMessage, /id: test-sse-event/)
  } finally {
    await application.stop()
  }
})

test('启用管理令牌后，错误令牌被拒绝，正确令牌只能创建受审计采集作业', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-admin-api-'))
  const config = loadConfig({
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', STORAGE_DRIVER: 'file', SCHEDULER_ENABLED: 'false',
    ADMIN_TOKEN: 'local-admin-test-token',
    FILE_DATA_DIR: path.join(directory, 'data'), RAW_STORAGE_DIR: path.join(directory, 'raw'), MONITORING_DIR: path.join(directory, 'logs'),
    SOURCES_PATH: path.resolve('data/sources.json'), BOOTSTRAP_PATH: path.resolve('data/bootstrap.json'),
  })
  const application = await createApplication(config)
  const address = await application.start()
  const origin = `http://127.0.0.1:${address.port}`
  const collectUrl = `${origin}/api/v1/admin/sources/nbs-2025-national-bulletin/collect`
  try {
    const denied = await fetch(collectUrl, { method: 'POST', headers: { 'x-admin-token': 'wrong-token' } })
    assert.equal(denied.status, 401)

    const accepted = await fetch(collectUrl, { method: 'POST', headers: { 'x-admin-token': 'local-admin-test-token' } })
    assert.equal(accepted.status, 202)
    const body = await accepted.json()
    assert.equal(body.job.sourceId, 'nbs-2025-national-bulletin')
    assert.equal(body.job.status, 'pending')
    assert.equal((await application.repository.getStatus()).jobs.pending, 1)
  } finally {
    await application.stop()
  }
})
