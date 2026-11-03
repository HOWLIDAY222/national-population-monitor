import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPopulationViewModel } from './populationViewModel.js'

const regions = Array.from({ length: 31 }, (_, index) => ({
  regionCode: `R${String(index + 1).padStart(2, '0')}`,
  regionName: `地区${index + 1}`,
}))

const historyFor = (period, baseValue) => regions.map((region, index) => ({
  ...region,
  indicatorCode: 'census_population_total',
  period,
  value: (baseValue + index) * 10000,
}))

test('31省年度人口构成当前地图，普查与年度数据共同构成历史切片', () => {
  const annualRecords = regions.map((region, index) => ({
    ...region,
    indicatorCode: 'province_population_total',
    period: '2025',
    value: 1000 + index,
  }))
  const model = buildPopulationViewModel({
    snapshot: {
      generatedAt: '2026-07-16T00:00:00.000Z',
      records: annualRecords,
      status: { pendingValidation: 0 },
      versions: [{ versionCode: 'provincial-annual-2025' }],
    },
    sources: [],
    events: [],
    regionalHistory: [
      ...historyFor('2010-11-01', 900),
      ...historyFor('2020-11-01', 950),
    ],
    annualRegionalHistory: annualRecords,
  })

  assert.equal(model.hasOfficialPopulationMap, true)
  assert.equal(model.regionalPopulationPeriod, '2025')
  assert.equal(model.regionalPopulationByName['地区1'], 1000)
  assert.equal(model.regionalPopulationHistory['2010-11-01']['地区1'], 900)
  assert.equal(model.regionalPopulationHistory['2025']['地区31'], 1030)
  assert.deepEqual(model.officialCensusPeriods, ['2010-11-01', '2020-11-01'])
  assert.deepEqual(model.officialRegionalPeriods, ['2010-11-01', '2020-11-01', '2025'])
  assert.equal(model.hasHistoricalPopulationMap, true)
})
