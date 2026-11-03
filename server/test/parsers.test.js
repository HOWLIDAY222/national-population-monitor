import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { parseSourceContent } from '../src/parsers/index.js'
import { bulletinHtml, loadProjectData, sampleSurveyHtml } from './fixtures.js'

const collectedAt = '2026-07-16T10:00:00.000Z'

const pdfBuffer = () => new Promise((resolve) => {
  const document = new PDFDocument({ autoFirstPage: true })
  const chunks = []
  document.on('data', (chunk) => chunks.push(chunk))
  document.on('end', () => resolve(Buffer.concat(chunks)))
  document.text('Total population 140489')
  document.end()
})

test('国家统计局年度公报解析为16条可追溯指标', async () => {
  const [sources, bootstrap] = await loadProjectData()
  const source = sources.find((item) => item.parserType === 'nbs-national-bulletin')
  const records = await parseSourceContent({ source, buffer: Buffer.from(bulletinHtml), definitions: bootstrap.indicatorDefinitions, collectedAt })
  assert.equal(records.length, 16)
  assert.equal(records.find((item) => item.indicatorCode === 'population_total').value, 140489)
  assert.equal(records.find((item) => item.indicatorCode === 'urbanization_rate').value, 67.9)
  assert.ok(records.every((item) => item.sourceUrl === source.url && item.parserVersion === source.parserVersion))
})

test('全国1%人口抽样调查与年末人口使用不同指标和统计时点', async () => {
  const [sources, bootstrap] = await loadProjectData()
  const source = sources.find((item) => item.parserType === 'nbs-sample-survey')
  const records = await parseSourceContent({ source, buffer: Buffer.from(sampleSurveyHtml), definitions: bootstrap.indicatorDefinitions, collectedAt })
  assert.equal(records.length, 5)
  assert.equal(records.find((item) => item.indicatorCode === 'survey_population_total').value, 140545)
  assert.equal(records.find((item) => item.indicatorCode === 'floating_population').value, 35788)
  assert.ok(records.every((item) => item.period === '2025-11-01' && item.dataStatus === 'survey'))
})

test('第六次人口普查地区表解析31省并核对全国口径差额', async () => {
  const [sources, bootstrap] = await loadProjectData()
  const source = sources.find((item) => item.parserType === 'nbs-sixth-census-provinces')
  const rows = [
    ['北京市',19612368,1.09,1.46],['天津市',12938224,0.79,0.97],['河北省',71854202,5.33,5.36],['山西省',35712111,2.60,2.67],['内蒙古自治区',24706321,1.88,1.84],
    ['辽宁省',43746323,3.35,3.27],['吉林省',27462297,2.16,2.05],['黑龙江省',38312224,2.91,2.86],['上海市',23019148,1.32,1.72],['江苏省',78659903,5.88,5.87],
    ['浙江省',54426891,3.69,4.06],['安徽省',59500510,4.73,4.44],['福建省',36894216,2.74,2.75],['江西省',44567475,3.27,3.33],['山东省',95793065,7.17,7.15],
    ['河南省',94023567,7.31,7.02],['湖北省',57237740,4.76,4.27],['湖南省',65683722,5.09,4.90],['广东省',104303132,6.83,7.79],['广西壮族自治区',46026629,3.55,3.44],
    ['海南省',8671518,0.62,0.65],['重庆市',28846170,2.44,2.15],['四川省',80418200,6.58,6.00],['贵州省',34746468,2.78,2.59],['云南省',45966239,3.39,3.43],
    ['西藏自治区',3002166,0.21,0.22],['陕西省',37327378,2.85,2.79],['甘肃省',25575254,2.02,1.91],['青海省',5626722,0.41,0.42],['宁夏回族自治区',6301350,0.44,0.47],['新疆维吾尔自治区',21813334,1.52,1.63],
  ]
  const html = `<html><body><table>${rows.map(([name,population,previous,share]) => `<tr><td>${name}</td><td>${population}</td><td>${previous.toFixed(2)}</td><td>${share.toFixed(2)}</td></tr>`).join('')}</table></body></html>`
  const records = await parseSourceContent({
    source,
    buffer: Buffer.from(html),
    definitions: bootstrap.indicatorDefinitions,
    collectedAt: '2026-07-16T00:00:00.000Z',
  })
  const populationRecords = records.filter((record) => record.indicatorCode === 'census_population_total')
  assert.equal(records.length, 62)
  assert.equal(populationRecords.reduce((sum, record) => sum + record.value, 0), 1332774867)
  assert.equal(populationRecords.find((record) => record.regionCode === '110000').value, 19612368)
  assert.equal(populationRecords.find((record) => record.regionCode === '440000').value, 104303132)
  const xinjiangShare = records.find((record) => record.regionCode === '650000' && record.indicatorCode === 'census_population_share')
  assert.equal(xinjiangShare.value, 1.63)
  assert.equal(xinjiangShare.dimensions.previousShare2000, 1.52)
})

test('第七次人口普查地区表解析31省人口与占比并校验合计', async () => {
  const [sources, bootstrap] = await loadProjectData()
  const source = sources.find((item) => item.parserType === 'nbs-seventh-census-provinces')
  const rows = [
    ['北京',21893095,1.55,1.46],['天津',13866009,0.98,0.97],['河北',74610235,5.28,5.36],['山西',34915616,2.47,2.67],['内蒙古',24049155,1.70,1.84],
    ['辽宁',42591407,3.02,3.27],['吉林',24073453,1.71,2.05],['黑龙江',31850088,2.26,2.86],['上海',24870895,1.76,1.72],['江苏',84748016,6.00,5.87],
    ['浙江',64567588,4.57,4.06],['安徽',61027171,4.32,4.44],['福建',41540086,2.94,2.75],['江西',45188635,3.20,3.33],['山东',101527453,7.19,7.15],
    ['河南',99365519,7.04,7.02],['湖北',57752557,4.09,4.27],['湖南',66444864,4.71,4.90],['广东',126012510,8.93,7.79],['广西',50126804,3.55,3.44],
    ['海南',10081232,0.71,0.65],['重庆',32054159,2.27,2.15],['四川',83674866,5.93,6.00],['贵州',38562148,2.73,2.59],['云南',47209277,3.34,3.43],
    ['西藏',3648100,0.26,0.22],['陕西',39528999,2.80,2.79],['甘肃',25019831,1.77,1.91],['青海',5923957,0.42,0.42],['宁夏',7202654,0.51,0.47],['新疆',25852345,1.83,1.63],
  ]
  const html = `<html><body><table>${rows.map(([name,population,share,previous]) => `<tr><td>${name}</td><td>${population}</td><td>${share.toFixed(2)}</td><td>${previous.toFixed(2)}</td></tr>`).join('')}</table></body></html>`
  const records = await parseSourceContent({
    source,
    buffer: Buffer.from(html),
    definitions: bootstrap.indicatorDefinitions,
    collectedAt: '2026-07-16T00:00:00.000Z',
  })
  assert.equal(records.length, 62)
  assert.equal(records.filter((record) => record.indicatorCode === 'census_population_total').reduce((sum, record) => sum + record.value, 0), 1409778724)
  assert.equal(records.find((record) => record.regionCode === '440000' && record.indicatorCode === 'census_population_total').value, 126012510)
  assert.equal(records.find((record) => record.regionCode === '650000' && record.indicatorCode === 'census_population_share').value, 1.83)
})

test('省级年度公报提取人口并保留省级口径，缺失可选指标不伪造', async () => {
  const [, bootstrap] = await loadProjectData()
  const source = {
    id: 'province-annual-test-500000-2025',
    name: '2025年测试省级统计公报',
    institution: '测试统计局',
    url: 'https://example.gov.cn/2025.html',
    kind: 'html',
    parserType: 'provincial-annual-bulletin',
    parserVersion: 'provincial-annual-bulletin-v1',
    period: '2025',
    effectiveAt: '2025-12-31T23:59:59+08:00',
    sourcePublishedAt: '2026-03-26T10:00:00+08:00',
    dataStatus: 'official',
    regionCode: '500000',
    regionName: '重庆市',
    parserConfig: { minimumRecords: 6 },
  }
  const html = `<html><body><h1>2025年测试统计公报</h1><p>年末全市常住人口3187.26万人，其中，城镇常住人口2327.34万人，乡村人口859.92万人。常住人口城镇化率为73.02%。全年出生人口14.80万人，出生率为4.64‰；死亡人口29.50万人，死亡率为9.25‰；人口自然增长率为-4.61‰。</p></body></html>`
  const records = await parseSourceContent({
    source,
    buffer: Buffer.from(html),
    definitions: bootstrap.indicatorDefinitions,
    collectedAt: '2026-07-16T00:00:00.000Z',
  })

  assert.equal(records.length, 9)
  assert.equal(records.find((record) => record.indicatorCode === 'province_population_total').value, 3187.26)
  assert.equal(records.find((record) => record.indicatorCode === 'province_natural_growth_rate').value, -4.61)
  assert.ok(records.every((record) => record.regionCode === '500000' && record.period === '2025'))
  assert.ok(records.every((record) => record.dimensions.publicationKind === 'annual-bulletin'))
})

test('JSON和CSV结构化来源遵守统一映射契约', async () => {
  const [, bootstrap] = await loadProjectData()
  const base = {
    id: 'test-structured', name: '测试结构化来源', institution: '测试机构', url: 'https://example.gov/data',
    parserType: 'generic', parserVersion: 'generic-v1', period: '2025', effectiveAt: '2025-12-31T23:59:59+08:00',
    sourcePublishedAt: '2026-01-01T00:00:00+08:00', dataStatus: 'official',
    parserConfig: { columns: { indicatorCode: 'code', value: 'value', unit: 'unit', regionCode: 'region' } },
  }
  const json = await parseSourceContent({
    source: { ...base, kind: 'json', parserConfig: { ...base.parserConfig, recordsPath: 'data' } },
    buffer: Buffer.from(JSON.stringify({ data: [{ code: 'population_total', value: '140,489', unit: '万人', region: 'CN' }] })),
    definitions: bootstrap.indicatorDefinitions, collectedAt,
  })
  const csv = await parseSourceContent({
    source: { ...base, kind: 'csv' },
    buffer: Buffer.from('code,value,unit,region\npopulation_total,"140,489",万人,CN\n'),
    definitions: bootstrap.indicatorDefinitions, collectedAt,
  })
  assert.equal(json[0].value, 140489)
  assert.equal(csv[0].value, 140489)
})

test('Excel和PDF来源可进入同一标准记录模型', async () => {
  const [, bootstrap] = await loadProjectData()
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('人口')
  sheet.addRow(['code', 'value', 'unit', 'region'])
  sheet.addRow(['population_total', 140489, '万人', 'CN'])
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer())
  const base = {
    id: 'test-file', name: '测试文件来源', institution: '测试机构', url: 'https://example.gov/file',
    parserType: 'generic', parserVersion: 'generic-v1', period: '2025', effectiveAt: '2025-12-31T23:59:59+08:00',
    sourcePublishedAt: '2026-01-01T00:00:00+08:00', dataStatus: 'official',
  }
  const excel = await parseSourceContent({
    source: { ...base, kind: 'xlsx', parserConfig: { sheetName: '人口', columns: { indicatorCode: 'code', value: 'value', unit: 'unit', regionCode: 'region' } } },
    buffer: xlsx, definitions: bootstrap.indicatorDefinitions, collectedAt,
  })
  const pdf = await parseSourceContent({
    source: { ...base, kind: 'pdf', parserConfig: { regexRules: [{ indicatorCode: 'population_total', pattern: 'Total population ([0-9]+)', unit: '万人' }] } },
    buffer: await pdfBuffer(), definitions: bootstrap.indicatorDefinitions, collectedAt,
  })
  assert.equal(excel[0].value, 140489)
  assert.equal(pdf[0].value, 140489)
})

test('image-only provincial PDF records are accepted only for the audited content hash', async () => {
  const [, bootstrap] = await loadProjectData()
  const buffer = Buffer.from('audited image-only PDF fixture')
  const source = {
    id: 'province-annual-image-only-test',
    name: 'Image-only annual bulletin fixture',
    institution: 'Test statistics office',
    url: 'https://example.gov.cn/annual.pdf',
    kind: 'pdf',
    parserType: 'provincial-annual-bulletin',
    parserVersion: 'provincial-annual-bulletin-v3',
    period: '2025',
    effectiveAt: '2025-12-31T23:59:59+08:00',
    sourcePublishedAt: '2026-03-20T10:00:00+08:00',
    dataStatus: 'official',
    regionCode: '440000',
    regionName: 'Guangdong',
    parserConfig: {
      expectedContentHash: '4af72966ad1a66e0dc162a4ded553828b96b3c04e8e248f8b7dc89b715401d33',
      sourcePages: [2],
      minimumRecords: 2,
      imageOnlyRecords: [
        { indicatorCode: 'province_population_total', value: 12859, rawValue: 'Resident population 12859' },
        { indicatorCode: 'province_urbanization_rate', value: 76.58, rawValue: 'Urbanization rate 76.58%' },
      ],
    },
  }

  const records = await parseSourceContent({ source, buffer, definitions: bootstrap.indicatorDefinitions, collectedAt })
  assert.equal(records.length, 2)
  assert.equal(records[0].dimensions.extractionMethod, 'hash-locked-visual-transcription')
  assert.equal(records[0].dimensions.contentSha256, source.parserConfig.expectedContentHash)
  assert.equal(records[0].dimensions.sourcePages, '2')
  await assert.rejects(
    () => parseSourceContent({ source, buffer: Buffer.from('changed PDF'), definitions: bootstrap.indicatorDefinitions, collectedAt }),
    /content hash mismatch/i,
  )
})
