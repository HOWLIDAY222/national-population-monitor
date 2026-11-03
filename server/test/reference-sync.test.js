import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FileRepository } from '../src/storage/file-repository.js'

const source = {
  id: 'reference-sync-source',
  name: '参考数据同步来源',
  institution: '测试机构',
  url: 'https://example.com/data.json',
  kind: 'json',
  parserType: 'generic-json',
  parserVersion: 'generic-json-v1',
  checkIntervalSeconds: 60,
  enabled: true,
  autoPublish: false,
  datasetKey: 'reference-sync',
  period: '2026',
  effectiveAt: '2026-12-31T00:00:00+08:00',
  sourcePublishedAt: '2026-12-31T00:00:00+08:00',
  dataStatus: 'official',
  request: { timeoutMs: 5000, userAgent: 'PopulationPlatformTest/1.0' },
  parserConfig: { columns: { indicatorCode: 'indicator', value: 'value', unit: 'unit' } },
}

const definition = (code, name) => ({
  code,
  name,
  description: `${name}定义`,
  defaultUnit: '人',
  frequency: 'annual',
  valueType: 'number',
  minimumValue: 0,
  maximumValue: 1000,
  reviewChangeRatio: 0.1,
  autoPublish: false,
})

test('文件存储重启时同步新增指标定义和地区，同时保留运行状态', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-reference-sync-'))
  const dataDirectory = path.join(directory, 'data')
  const sourcesPath = path.join(directory, 'sources.json')
  const bootstrapPath = path.join(directory, 'bootstrap.json')
  await fs.writeFile(sourcesPath, JSON.stringify([source]), 'utf8')
  await fs.writeFile(bootstrapPath, JSON.stringify({
    regions: [{ code: 'CN', name: '全国', level: 'country', parentCode: null }],
    indicatorDefinitions: [definition('existing_metric', '原指标')],
    versions: [],
  }), 'utf8')

  const first = await new FileRepository({ directory: dataDirectory, sourcesPath, bootstrapPath }).init()
  await first.updateSource(source.id, { status: 'healthy', etag: 'stable-etag', lastContentHash: 'stable-hash' })
  await first.close()

  await fs.writeFile(bootstrapPath, JSON.stringify({
    regions: [
      { code: 'CN', name: '全国', level: 'country', parentCode: null },
      { code: '110000', name: '北京市', level: 'province', parentCode: 'CN' },
    ],
    indicatorDefinitions: [
      definition('existing_metric', '已更新指标'),
      definition('new_metric', '新增指标'),
    ],
    versions: [],
  }), 'utf8')

  const restarted = await new FileRepository({ directory: dataDirectory, sourcesPath, bootstrapPath }).init()
  const definitions = await restarted.listDefinitions()
  const regions = await restarted.listRegions()
  const restartedSource = await restarted.getSource(source.id)

  assert.equal(definitions.find((item) => item.code === 'existing_metric').name, '已更新指标')
  assert.ok(definitions.some((item) => item.code === 'new_metric'))
  assert.ok(regions.some((item) => item.code === '110000'))
  assert.equal(restartedSource.status, 'healthy')
  assert.equal(restartedSource.lastContentHash, 'stable-hash')

  await fs.writeFile(sourcesPath, JSON.stringify([{ ...source, url: 'https://example.com/reconfigured.json' }]), 'utf8')
  const reconfigured = await new FileRepository({ directory: dataDirectory, sourcesPath, bootstrapPath }).init()
  const reconfiguredSource = await reconfigured.getSource(source.id)
  assert.equal(reconfiguredSource.status, 'pending')
  assert.equal(reconfiguredSource.etag, null)
  assert.equal(reconfiguredSource.lastContentHash, null)
})
