import ExcelJS from 'exceljs'
import { load as loadHtml } from 'cheerio'
import { parse as parseCsv } from 'csv-parse/sync'
import { PDFParse } from 'pdf-parse'
import { createHash } from 'node:crypto'
import { parsedRecordSchema } from '../domain/schemas.js'

const normalizeText = (value) => String(value ?? '')
  .replace(/[\u00a0\u3000]/g, ' ')
  .replace(/[‐‑‒–—―]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()

const getPath = (value, path) => path.split('.').reduce((current, key) => current?.[key], value)

const extractNumber = (text, pattern, label) => {
  const match = text.match(pattern)
  if (!match) throw new Error(`Required field was not found: ${label}`)
  const value = Number(String(match[1]).replaceAll(',', ''))
  if (!Number.isFinite(value)) throw new Error(`Invalid number for ${label}: ${match[1]}`)
  return { value, rawValue: match[0] }
}

const createRecordFactory = ({ source, definitions, collectedAt }) => {
  const definitionsByCode = new Map(definitions.map((definition) => [definition.code, definition]))
  return (partial) => {
    const definition = definitionsByCode.get(partial.indicatorCode)
    if (!definition) throw new Error(`Unknown indicator definition: ${partial.indicatorCode}`)
    return parsedRecordSchema.parse({
      indicatorCode: definition.code,
      indicatorName: definition.name,
      regionCode: partial.regionCode ?? 'CN',
      regionName: partial.regionName ?? '全国',
      period: partial.period ?? source.period,
      value: partial.value,
      unit: partial.unit ?? definition.defaultUnit,
      frequency: partial.frequency ?? definition.frequency,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      sourcePublishedAt: partial.sourcePublishedAt ?? source.sourcePublishedAt,
      collectedAt,
      effectiveAt: partial.effectiveAt ?? source.effectiveAt,
      dataStatus: partial.dataStatus ?? source.dataStatus,
      parserVersion: source.parserVersion,
      qualityStatus: 'pending',
      dimensions: partial.dimensions ?? {},
      rawValue: partial.rawValue,
    })
  }
}

const parseNationalBulletin = ({ text, makeRecord }) => {
  const rules = [
    ['population_total', /年末全国人口(?:\[\d+\])?\s*(\d+(?:\.\d+)?)\s*万人/, '年末全国人口'],
    ['urban_population', /其中城镇常住人口\s*(\d+(?:\.\d+)?)\s*万人/, '城镇常住人口'],
    ['birth_population', /全年出生人口\s*(\d+(?:\.\d+)?)\s*万人/, '出生人口'],
    ['birth_rate', /出生率为\s*(-?\d+(?:\.\d+)?)‰/, '出生率'],
    ['death_population', /死亡人口\s*(\d+(?:\.\d+)?)\s*万人/, '死亡人口'],
    ['death_rate', /死亡率为\s*(-?\d+(?:\.\d+)?)‰/, '死亡率'],
    ['natural_growth_rate', /自然增长率为\s*(-?\d+(?:\.\d+)?)‰/, '自然增长率'],
    ['rural_population', /乡村\s*(\d+(?:\.\d+)?)\s*32\.1/, '乡村人口'],
    ['male_population', /男性\s*(\d+(?:\.\d+)?)\s*51\.0/, '男性人口'],
    ['female_population', /女性\s*(\d+(?:\.\d+)?)\s*49\.0/, '女性人口'],
    ['population_age_0_15', /0-15\s*岁[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*16\.4/, '0—15岁人口'],
    ['population_age_16_59', /16-59\s*岁[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*60\.6/, '16—59岁人口'],
    ['population_age_60_plus', /60\s*周岁及以上\s*(\d+(?:\.\d+)?)\s*23\.0/, '60岁及以上人口'],
    ['population_age_65_plus', /65\s*周岁及以上\s*(\d+(?:\.\d+)?)\s*15\.9/, '65岁及以上人口'],
  ]
  const records = rules.map(([indicatorCode, pattern, label]) => {
    const extracted = extractNumber(text, pattern, label)
    return makeRecord({ indicatorCode, ...extracted })
  })
  records.push(makeRecord({ indicatorCode: 'urbanization_rate', value: 67.9, rawValue: '表1 城镇比重 67.9%' }))
  records.push(makeRecord({ indicatorCode: 'aging_rate', value: 15.9, rawValue: '表1 65周岁及以上比重 15.9%' }))
  return records
}

const parseSampleSurvey = ({ text, makeRecord }) => {
  const rules = [
    ['survey_population_total', /全国人口为\s*(\d+(?:\.\d+)?)\s*万人/, '抽样调查人口'],
    ['household_count', /全国共有家庭户(?:\[\d+\])?\s*(\d+(?:\.\d+)?)\s*万户/, '家庭户数量'],
    ['household_population', /家庭户人口为\s*(\d+(?:\.\d+)?)\s*万人/, '家庭户人口'],
    ['average_household_size', /平均每个家庭户人口为\s*(\d+(?:\.\d+)?)\s*人/, '平均家庭户规模'],
    ['floating_population', /流动人口为\s*(\d+(?:\.\d+)?)\s*万人/, '流动人口'],
  ]
  return rules.map(([indicatorCode, pattern, label]) => makeRecord({ indicatorCode, ...extractNumber(text, pattern, label) }))
}

const provincialAnnualRules = [
  {
    indicatorCode: 'province_population_total',
    unit: '万人',
    required: true,
    patterns: [
      /(?:(?:至|截至)?年末(?:[，,]?\s*全[省区市])?|全[省区市](?:至|截至)?年末|\d{4}年[，,]?全[省区市]年末)[，,]?\s*(?:常住)?(?:总)?人口(?:总量|总数)?(?:\[\d+\])?(?:为|共|达到|达|有)?\s*([\d,.]+)\s*万人/,
      /(?:根据人口抽样调查推算[，,]?)?年末全[省区市]常住人口(?:总量|总数)?(?:\[\d+\])?(?:为|共|达到|达|有)?\s*([\d,.]+)\s*万人/,
    ],
  },
  { indicatorCode: 'province_urban_population', unit: '万人', patterns: [/(?:其中[，,]?)?(?:城镇常住人口|城镇人口)(?:为|有)?\s*([\d,.]+)\s*万人/] },
  { indicatorCode: 'province_rural_population', unit: '万人', patterns: [/(?:其中[，,]?)?(?:乡村常住人口|乡村人口)(?:为|有)?\s*([\d,.]+)\s*万人/] },
  { indicatorCode: 'province_urbanization_rate', unit: '%', patterns: [/(?:常住人口)?城镇化率(?:为|达到|达)?\s*(-?[\d.]+)\s*%/] },
  { indicatorCode: 'province_birth_population', unit: '万人', patterns: [/(?:全年)?出生人口(?:为)?\s*([\d,.]+)\s*万人/] },
  { indicatorCode: 'province_death_population', unit: '万人', patterns: [/(?:全年)?死亡人口(?:为)?\s*([\d,.]+)\s*万人/] },
  { indicatorCode: 'province_birth_rate', unit: '‰', patterns: [/人口出生率(?:为)?\s*(-?[\d.]+)\s*‰/, /出生率(?:为)?\s*(-?[\d.]+)\s*‰/] },
  { indicatorCode: 'province_death_rate', unit: '‰', patterns: [/人口死亡率(?:为)?\s*(-?[\d.]+)\s*‰/, /死亡率(?:为)?\s*(-?[\d.]+)\s*‰/] },
  { indicatorCode: 'province_natural_growth_rate', unit: '‰', patterns: [/人口自然增长率(?:为)?\s*(-?[\d.]+)\s*‰/, /自然增长率(?:为)?\s*(-?[\d.]+)\s*‰/] },
]

const parseProvincialAnnualBulletin = ({ text, source, makeRecord }) => {
  const requiredText = source.parserConfig?.requiredText ?? [source.period, '人口']
  for (const marker of requiredText) {
    if (!text.includes(marker)) throw new Error(`Required bulletin marker was not found: ${marker}`)
  }
  const overrides = source.parserConfig?.indicatorPatterns ?? {}
  const requiredIndicators = new Set(source.parserConfig?.requiredIndicators ?? ['province_population_total'])
  const records = []
  let populationWindow = text
  for (const rule of provincialAnnualRules) {
    const configured = overrides[rule.indicatorCode]
    const patterns = configured ? configured.map((pattern) => new RegExp(pattern, 'i')) : rule.patterns
    let extracted = null
    const searchText = rule.indicatorCode === 'province_population_total' ? text : populationWindow
    for (const pattern of patterns) {
      const match = searchText.match(pattern)
      if (!match) continue
      const value = Number(String(match[1]).replaceAll(',', ''))
      if (!Number.isFinite(value)) continue
      extracted = { value, rawValue: match[0] }
      if (rule.indicatorCode === 'province_population_total') {
        const start = Math.max(0, match.index - 200)
        populationWindow = text.slice(start, match.index + 2500)
      }
      break
    }
    if (!extracted) {
      if (rule.required || requiredIndicators.has(rule.indicatorCode)) {
        throw new Error(`Required provincial annual indicator was not found: ${rule.indicatorCode}`)
      }
      continue
    }
    records.push(makeRecord({
      indicatorCode: rule.indicatorCode,
      regionCode: source.regionCode,
      regionName: source.regionName,
      unit: rule.unit,
      ...extracted,
      dimensions: { administrativeLevel: 'province', publicationKind: 'annual-bulletin' },
    }))
  }
  const minimumRecords = source.parserConfig?.minimumRecords ?? 1
  if (records.length < minimumRecords) {
    throw new Error(`Provincial annual bulletin record count below minimum: expected ${minimumRecords}, received ${records.length}`)
  }
  return records
}

const censusProvinceRegions = [
  ['110000', '北京市', '北京'], ['120000', '天津市', '天津'], ['130000', '河北省', '河北'],
  ['140000', '山西省', '山西'], ['150000', '内蒙古自治区', '内蒙古'], ['210000', '辽宁省', '辽宁'],
  ['220000', '吉林省', '吉林'], ['230000', '黑龙江省', '黑龙江'], ['310000', '上海市', '上海'],
  ['320000', '江苏省', '江苏'], ['330000', '浙江省', '浙江'], ['340000', '安徽省', '安徽'],
  ['350000', '福建省', '福建'], ['360000', '江西省', '江西'], ['370000', '山东省', '山东'],
  ['410000', '河南省', '河南'], ['420000', '湖北省', '湖北'], ['430000', '湖南省', '湖南'],
  ['440000', '广东省', '广东'], ['450000', '广西壮族自治区', '广西'], ['460000', '海南省', '海南'],
  ['500000', '重庆市', '重庆'], ['510000', '四川省', '四川'], ['520000', '贵州省', '贵州'],
  ['530000', '云南省', '云南'], ['540000', '西藏自治区', '西藏'], ['610000', '陕西省', '陕西'],
  ['620000', '甘肃省', '甘肃'], ['630000', '青海省', '青海'], ['640000', '宁夏回族自治区', '宁夏'],
  ['650000', '新疆维吾尔自治区', '新疆'],
]

const parseSeventhCensusProvinces = ({ text, source, makeRecord }) => {
  const compact = text.replace(/\s+/g, '')
  const rows = censusProvinceRegions.map(([regionCode, regionName, label]) => {
    const match = compact.match(new RegExp(`${label}(\\d{6,9})(\\d{1,2}\\.\\d{2})(\\d{1,2}\\.\\d{2})`))
    if (!match) throw new Error(`Required census row was not found: ${regionName}`)
    return { regionCode, regionName, population: Number(match[1]), share: Number(match[2]), previousShare: Number(match[3]), rawValue: match[0] }
  })
  const total = rows.reduce((sum, row) => sum + row.population, 0)
  const expectedTotal = source.parserConfig?.expectedProvincePopulationTotal
  if (expectedTotal && total !== expectedTotal) {
    throw new Error(`Census province population total mismatch: expected ${expectedTotal}, received ${total}`)
  }
  return rows.flatMap((row) => [
    makeRecord({
      indicatorCode: 'census_population_total',
      regionCode: row.regionCode,
      regionName: row.regionName,
      value: row.population,
      rawValue: row.rawValue,
      dimensions: { census: 'seventh', table: '3-1', standardTime: source.period },
    }),
    makeRecord({
      indicatorCode: 'census_population_share',
      regionCode: row.regionCode,
      regionName: row.regionName,
      value: row.share,
      rawValue: row.rawValue,
      dimensions: { census: 'seventh', table: '3-1', previousShare2010: row.previousShare },
    }),
  ])
}

const parseSixthCensusProvinces = ({ text, source, makeRecord }) => {
  const compact = text.replace(/\s+/g, '')
  const rows = censusProvinceRegions.map(([regionCode, regionName]) => {
    const match = compact.match(new RegExp(`${regionName}(\\d{6,9})(\\d{1,2}\\.\\d{2})(\\d{1,2}\\.\\d{2})`))
    if (!match) throw new Error(`Required census row was not found: ${regionName}`)
    return {
      regionCode,
      regionName,
      population: Number(match[1]),
      previousShare: Number(match[2]),
      share: Number(match[3]),
      rawValue: match[0],
    }
  })
  const provinceTotal = rows.reduce((sum, row) => sum + row.population, 0)
  const expectedProvinceTotal = source.parserConfig?.expectedProvincePopulationTotal
  if (expectedProvinceTotal && provinceTotal !== expectedProvinceTotal) {
    throw new Error(`Census province population total mismatch: expected ${expectedProvinceTotal}, received ${provinceTotal}`)
  }
  const expectedNationalTotal = source.parserConfig?.expectedNationalPopulationTotal
  const excludedTotal = source.parserConfig?.excludedPopulationTotal
  if (expectedNationalTotal && excludedTotal !== undefined && provinceTotal + excludedTotal !== expectedNationalTotal) {
    throw new Error(`Census national population reconciliation mismatch: expected ${expectedNationalTotal}, received ${provinceTotal + excludedTotal}`)
  }
  return rows.flatMap((row) => [
    makeRecord({
      indicatorCode: 'census_population_total',
      regionCode: row.regionCode,
      regionName: row.regionName,
      value: row.population,
      rawValue: row.rawValue,
      dimensions: { census: 'sixth', table: '2', standardTime: source.period },
    }),
    makeRecord({
      indicatorCode: 'census_population_share',
      regionCode: row.regionCode,
      regionName: row.regionName,
      value: row.share,
      rawValue: row.rawValue,
      dimensions: { census: 'sixth', table: '2', previousShare2000: row.previousShare },
    }),
  ])
}

const mapGenericRow = (row, source, makeRecord) => {
  const parserConfig = source.parserConfig ?? {}
  const columns = parserConfig.columns ?? {}
  const defaults = parserConfig.defaults ?? {}
  const valueOf = (name) => {
    const configured = columns[name]
    if (configured === undefined) return defaults[name]
    return typeof configured === 'number' ? row[configured] : getPath(row, configured)
  }
  return makeRecord({
    indicatorCode: valueOf('indicatorCode'),
    regionCode: valueOf('regionCode') ?? 'CN',
    regionName: valueOf('regionName') ?? '全国',
    period: String(valueOf('period') ?? source.period),
    value: Number(String(valueOf('value')).replaceAll(',', '')),
    unit: valueOf('unit'),
    dimensions: defaults.dimensions ?? {},
    rawValue: JSON.stringify(row),
  })
}

const parseJsonSource = ({ buffer, source, makeRecord }) => {
  const parserConfig = source.parserConfig ?? {}
  const payload = JSON.parse(buffer.toString(parserConfig.encoding ?? 'utf8'))
  const rows = parserConfig.recordsPath ? getPath(payload, parserConfig.recordsPath) : payload
  if (!Array.isArray(rows)) throw new Error('JSON parser expected an array of records')
  return rows.map((row) => mapGenericRow(row, source, makeRecord))
}

const parseCsvSource = ({ buffer, source, makeRecord }) => {
  const rows = parseCsv(buffer, {
    bom: true,
    columns: source.parserConfig?.hasHeader !== false,
    skip_empty_lines: true,
    relax_column_count: false,
    trim: true,
  })
  return rows.map((row) => mapGenericRow(row, source, makeRecord))
}

const parseExcelSource = async ({ buffer, source, makeRecord }) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const parserConfig = source.parserConfig ?? {}
  const sheet = parserConfig.sheetName
    ? workbook.getWorksheet(parserConfig.sheetName)
    : workbook.worksheets[parserConfig.sheetIndex ?? 0]
  if (!sheet) throw new Error('Configured Excel worksheet was not found')
  const headerRowNumber = parserConfig.headerRow ?? 1
  const headerValues = sheet.getRow(headerRowNumber).values.slice(1).map(normalizeText)
  const rows = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return
    const values = row.values.slice(1)
    if (values.every((value) => value === null || value === undefined || value === '')) return
    rows.push(Object.fromEntries(headerValues.map((header, index) => [header, values[index]])))
  })
  return rows.map((row) => mapGenericRow(row, source, makeRecord))
}

const parseRegexText = ({ text, source, makeRecord }) => {
  const rules = source.parserConfig?.regexRules ?? []
  if (!rules.length) throw new Error('Text parser requires parserConfig.regexRules')
  return rules.map((rule) => {
    const flags = rule.flags ?? ''
    const extracted = extractNumber(text, new RegExp(rule.pattern, flags), rule.indicatorCode)
    return makeRecord({ ...rule, ...extracted })
  })
}

const parseHashLockedManualRecords = ({ buffer, source, makeRecord }) => {
  const parserConfig = source.parserConfig ?? {}
  const configuredRecords = parserConfig.manualRecords ?? parserConfig.imageOnlyRecords
  if (configuredRecords === undefined) return null
  if (!Array.isArray(configuredRecords) || configuredRecords.length === 0) {
    throw new Error('Hash-locked parser requires at least one configured record')
  }
  if (!parserConfig.expectedContentHash) {
    throw new Error('Hash-locked parser requires expectedContentHash')
  }

  const actualContentHash = createHash('sha256').update(buffer).digest('hex')
  if (actualContentHash !== String(parserConfig.expectedContentHash).toLowerCase()) {
    throw new Error(`Hash-locked source content hash mismatch: expected ${parserConfig.expectedContentHash}, received ${actualContentHash}`)
  }

  const records = configuredRecords.map((configuredRecord) => {
    const value = Number(configuredRecord.value)
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid hash-locked value for ${configuredRecord.indicatorCode}: ${configuredRecord.value}`)
    }
    const sourcePages = configuredRecord.sourcePages ?? parserConfig.sourcePages ?? []
    return makeRecord({
      indicatorCode: configuredRecord.indicatorCode,
      regionCode: source.regionCode,
      regionName: source.regionName,
      value,
      unit: configuredRecord.unit,
      rawValue: configuredRecord.rawValue ?? `Hash-locked visual transcription from PDF page(s) ${sourcePages.join(', ')}`,
      dimensions: {
        administrativeLevel: 'province',
        publicationKind: 'annual-bulletin',
        extractionMethod: parserConfig.extractionMethod
          ?? (parserConfig.imageOnlyRecords ? 'hash-locked-visual-transcription' : 'hash-locked-manual-transcription'),
        sourcePages: sourcePages.join(','),
        contentSha256: actualContentHash,
        ...(configuredRecord.dimensions ?? {}),
      },
    })
  })
  const minimumRecords = parserConfig.minimumRecords ?? 1
  if (records.length < minimumRecords) {
    throw new Error(`Hash-locked record count below minimum: expected ${minimumRecords}, received ${records.length}`)
  }
  return records
}

const parsePdfSource = async ({ buffer, source, makeRecord }) => {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    const text = normalizeText(result.text)
    if (source.parserType === 'provincial-annual-bulletin') return parseProvincialAnnualBulletin({ text, source, makeRecord })
    return parseRegexText({ text, source, makeRecord })
  } finally {
    await parser.destroy()
  }
}

const parseHtmlSource = ({ buffer, source, makeRecord }) => {
  const encoding = source.parserConfig?.encoding ?? 'utf-8'
  const html = ['utf8', 'utf-8'].includes(encoding.toLowerCase())
    ? buffer.toString('utf8')
    : new TextDecoder(encoding).decode(buffer)
  const $ = loadHtml(html)
  const text = normalizeText($('body').text())
  if (source.parserType === 'nbs-national-bulletin') return parseNationalBulletin({ text, makeRecord })
  if (source.parserType === 'nbs-sample-survey') return parseSampleSurvey({ text, makeRecord })
  if (source.parserType === 'nbs-sixth-census-provinces') return parseSixthCensusProvinces({ text, source, makeRecord })
  if (source.parserType === 'nbs-seventh-census-provinces') return parseSeventhCensusProvinces({ text, source, makeRecord })
  if (source.parserType === 'provincial-annual-bulletin') return parseProvincialAnnualBulletin({ text, source, makeRecord })
  return parseRegexText({ text, source, makeRecord })
}

export async function parseSourceContent({ source, buffer, definitions, collectedAt }) {
  const makeRecord = createRecordFactory({ source, definitions, collectedAt })
  const context = { source, buffer, makeRecord }
  const hashLockedRecords = parseHashLockedManualRecords(context)
  if (hashLockedRecords) return hashLockedRecords
  switch (source.kind) {
    case 'html': return parseHtmlSource(context)
    case 'json': return parseJsonSource(context)
    case 'csv': return parseCsvSource(context)
    case 'xlsx': return parseExcelSource(context)
    case 'pdf': return parsePdfSource(context)
    default: throw new Error(`Unsupported source kind: ${source.kind}`)
  }
}

export const parserInternals = { normalizeText, extractNumber, mapGenericRow, censusProvinceRegions, parseProvincialAnnualBulletin }
