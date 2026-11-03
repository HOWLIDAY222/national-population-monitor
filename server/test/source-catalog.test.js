import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSources } from '../src/domain/schemas.js'
import { loadProjectData } from './fixtures.js'

test('31个省级统计门户与省级行政区一一对应且只进入发现监测层', async () => {
  const [sourceInput, bootstrap] = await loadProjectData()
  const sources = parseSources(sourceInput)
  const portals = sources.filter((source) => source.role === 'portal')
  const provinceCodes = bootstrap.regions.filter((region) => region.level === 'province').map((region) => region.code).sort()

  assert.equal(portals.length, 31)
  assert.deepEqual(portals.map((source) => source.regionCode).sort(), provinceCodes)
  assert.equal(new Set(portals.map((source) => new URL(source.url).hostname)).size, 31)
  assert.ok(portals.every((source) => source.monitorOnly && !source.autoPublish && source.parserType === 'official-portal-monitor'))
  assert.ok(portals.every((source) => source.parserConfig.catalogReferenceUrl.startsWith('https://www.stats.gov.cn/')))
})

test('31个省级年度人口适配器使用独立数据集并强制人工审核', async () => {
  const [sourceInput] = await loadProjectData()
  const sources = parseSources(sourceInput).filter((source) => source.parserType === 'provincial-annual-bulletin')

  assert.equal(sources.length, 31)
  assert.equal(new Set(sources.map((source) => source.regionCode)).size, 31)
  assert.equal(new Set(sources.map((source) => source.datasetKey)).size, 31)
  assert.ok(sources.every((source) => source.role === 'dataset' && !source.monitorOnly && !source.autoPublish))
  assert.ok(sources.every((source) => source.period === '2025' && source.dataStatus === 'official'))
})
