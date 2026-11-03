import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPopulationViewModel } from '../../src/data/populationViewModel.js'
import { loadProjectData } from './fixtures.js'

test('正式普查历史按统计时点构建两个完整31省地图切片', async () => {
  const [, bootstrap] = await loadProjectData()
  const regions = bootstrap.regions.filter((region) => region.code !== 'CN')
  const values2010 = new Map([
    ['110000', 19612368],
    ['440000', 104303132],
  ])
  const values2020 = new Map([
    ['110000', 21893095],
    ['440000', 126012510],
  ])
  const makeRecords = (period, values, fallback) => regions.map((region, index) => ({
    indicatorCode: 'census_population_total',
    regionCode: region.code,
    regionName: region.name,
    period,
    value: values.get(region.code) ?? fallback + index,
    effectiveAt: `${period}T00:00:00+08:00`,
  }))
  const history2010 = makeRecords('2010-11-01', values2010, 10_000_000)
  const history2020 = makeRecords('2020-11-01', values2020, 20_000_000)
  const viewModel = buildPopulationViewModel({
    snapshot: { generatedAt: '2026-07-16T10:00:00.000Z', records: history2020, versions: [], status: {} },
    sources: [],
    events: [],
    regionalHistory: [...history2020, ...history2010],
  })

  assert.equal(viewModel.hasOfficialPopulationMap, true)
  assert.equal(viewModel.hasHistoricalPopulationMap, true)
  assert.deepEqual(viewModel.officialCensusPeriods, ['2010-11-01', '2020-11-01'])
  assert.equal(viewModel.regionalPopulationHistory['2010-11-01']['北京市'], 1961.2368)
  assert.equal(viewModel.regionalPopulationHistory['2020-11-01']['广东省'], 12601.251)
})
