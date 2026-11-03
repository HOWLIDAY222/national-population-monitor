const toNumber = (value) => value === null || value === undefined || value === ''
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null
const toYi = (wanren) => wanren === null ? '—' : (wanren / 10000).toFixed(2)
const formatMetricValue = (value) => value === null ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const formatTime = (value) => value
  ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  : '—'

const sourceStateLabel = {
  healthy: '正常',
  delayed: '延迟',
  failed: '失败',
  pending: '待首检',
  disabled: '已停用',
}

const eventTone = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  info: 'info',
}

const eventCategory = {
  'version.published': '版本',
  'version.rolled_back': '回滚',
  'indicator.updated': '指标',
  'indicator.history_added': '历史',
  'validation.pending': '审核',
  'validation.rejected': '校验',
  'parser.failed': '解析',
  'source.failed': '采集',
  'source.checked': '巡检',
  'source.changed': '发现',
  'source.discovery': '候选',
}

const eventMessage = (event) => {
  if (event.eventType === 'indicator.updated') {
    const before = event.previousValue === null ? '首次发布' : formatMetricValue(event.previousValue)
    return `${event.indicatorName ?? event.indicatorCode} ${before} → ${formatMetricValue(event.currentValue)}${event.unit ?? ''}`
  }
  if (event.eventType === 'indicator.history_added') {
    return `${event.regionName ?? '地区'} ${event.indicatorName ?? '指标'} 补录 ${event.details?.period ?? '历史期'} 正式数据`
  }
  if (event.eventType === 'version.published') return `${event.versionCode ?? '正式版本'} 已发布`
  if (event.eventType === 'version.rolled_back') return `已回滚至 ${event.versionCode ?? '上一正式版本'}`
  return event.indicatorName ?? event.triggerRule ?? event.eventType
}

export function buildPopulationViewModel({ snapshot, sources, events, discoveries = [], regionalHistory = [], annualRegionalHistory = [] }) {
  const records = snapshot?.records ?? []
  const recordByCode = new Map(records.map((record) => [record.indicatorCode, record]))
  const record = (code) => recordByCode.get(code)
  const value = (code) => toNumber(record(code)?.value)
  const datasetSources = sources.filter((source) => source.role !== 'portal')
  const portalSources = sources.filter((source) => source.role === 'portal')
  const totalSources = datasetSources.length
  const onlineSources = datasetSources.filter((source) => source.status === 'healthy').length
  const onlinePortals = portalSources.filter((source) => source.status === 'healthy').length
  const reachablePortals = portalSources.filter((source) => source.lastSuccessAt).length
  const sourceCoverage = totalSources ? onlineSources / totalSources * 100 : null
  const total = value('population_total')
  const floating = value('floating_population')
  const urbanization = value('urbanization_rate')
  const aging = value('aging_rate')
  const pendingValidation = snapshot?.status?.pendingValidation ?? 0
  const publishedVersionCount = snapshot?.versions?.length ?? 0
  const hasOfficialData = Boolean(snapshot?.records?.length)
  const censusPopulationRecords = records.filter((item) => item.indicatorCode === 'census_population_total')
  const annualPopulationRecords = records.filter((item) => item.indicatorCode === 'province_population_total')
  const annualPeriods = [...new Set(annualPopulationRecords.map((item) => item.period))].sort((a, b) => a.localeCompare(b))
  const latestAnnualPeriod = annualPeriods.at(-1) ?? null
  const currentRegionalPopulationRecords = latestAnnualPeriod
    ? annualPopulationRecords.filter((item) => item.period === latestAnnualPeriod)
    : censusPopulationRecords
  const regionalPopulationByName = Object.fromEntries(currentRegionalPopulationRecords.map((item) => [
    item.regionName,
    toNumber(item.value) === null ? null : item.indicatorCode === 'census_population_total' ? toNumber(item.value) / 10000 : toNumber(item.value),
  ]))
  const regionalPopulationHistory = regionalHistory.reduce((periods, item) => {
    if (!item.period || !item.regionName || toNumber(item.value) === null) return periods
    periods[item.period] ??= {}
    periods[item.period][item.regionName] = toNumber(item.value) / 10000
    return periods
  }, {})
  for (const item of annualRegionalHistory) {
    if (!item.period || !item.regionName || toNumber(item.value) === null) continue
    regionalPopulationHistory[item.period] ??= {}
    regionalPopulationHistory[item.period][item.regionName] = toNumber(item.value)
  }
  const officialCensusPeriods = Object.keys(regionalPopulationHistory)
    .filter((period) => period.includes('-') && Object.keys(regionalPopulationHistory[period]).length === 31)
    .sort((a, b) => a.localeCompare(b))
  const officialRegionalPeriods = Object.keys(regionalPopulationHistory)
    .filter((period) => Object.keys(regionalPopulationHistory[period]).length === 31)
    .sort((a, b) => a.localeCompare(b))

  const metrics = [
    { key: 'total', label: '年末全国人口', value: toYi(total), unit: '亿人', change: record('population_total')?.period ?? '—', status: '官方 · 已审核' },
    { key: 'floating', label: '流动人口', value: toYi(floating), unit: '亿人', change: record('floating_population')?.period ?? '—', status: '1% 抽样调查' },
    { key: 'urbanization', label: '城镇化率', value: formatMetricValue(urbanization), unit: '%', change: record('urbanization_rate')?.period ?? '—', status: '官方 · 已审核' },
    { key: 'aging', label: '65岁及以上', value: formatMetricValue(aging), unit: '%', change: record('aging_rate')?.period ?? '—', status: '官方 · 已审核' },
    { key: 'density', label: '人口密度', value: '—', unit: '', change: '当前正式来源未发布', status: '不推算' },
    { key: 'coverage', label: '来源在线率', value: formatMetricValue(sourceCoverage), unit: '%', change: `${onlineSources}/${totalSources || 0} 个来源`, status: pendingValidation ? `${pendingValidation} 条待审核` : '链路正常' },
  ]

  const sourceStatus = datasetSources.map((source) => ({
    name: source.name,
    latency: source.lastCheckedAt ? `检查 ${formatTime(source.lastCheckedAt)}` : '尚未检查',
    status: sourceStateLabel[source.status] ?? source.status,
  })).concat(portalSources.length ? [{
    name: '31省级统计门户发现层',
    latency: `${reachablePortals}/${portalSources.length} 个门户可达，其中 ${onlinePortals} 个使用正常 TLS；候选资源 ${discoveries.length} 条`,
    status: reachablePortals === portalSources.length && onlinePortals === portalSources.length ? '正常' : reachablePortals ? '降级监测' : '待首检',
  }] : [])

  const observationEvents = events.slice(0, 12).map((event) => ({
    region: event.regionName ?? '全国',
    message: eventMessage(event),
    tone: eventTone[event.severity] ?? 'info',
    category: eventCategory[event.eventType] ?? '数据',
    rule: event.triggerRule ?? '正式版本事件',
    time: formatTime(event.occurredAt),
  }))

  const anomalies = [
    ...datasetSources.filter((source) => ['delayed', 'failed'].includes(source.status)).map((source) => ({
      region: source.institution,
      message: source.status === 'failed' ? '采集失败，当前继续使用上一正式版本' : '来源检查延迟，当前继续使用上一正式版本',
      tone: source.status === 'failed' ? 'danger' : 'warning',
      rule: source.lastError ?? `数据源状态为 ${source.status}`,
    })),
    ...(pendingValidation ? [{
      region: '审核队列',
      message: `${pendingValidation} 条新记录待人工审核，尚未进入正式快照`,
      tone: 'warning',
      rule: '正式数据必须通过显式发布门禁',
    }] : []),
  ]

  const dataVersion = {
    id: publishedVersionCount ? `正式组合快照 · ${publishedVersionCount} 个版本` : '暂无正式版本',
    label: hasOfficialData ? '国家统计局正式公开数据' : '演示降级数据',
    source: hasOfficialData ? '31省级年度人口公报、1% 抽样调查与第六、七次人口普查保持独立统计口径' : '接口不可用，未混入正式快照',
    status: hasOfficialData ? '正式发布' : '演示降级',
    updatedAt: snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '—',
  }

  return {
    metrics,
    sourceStatus,
    events: observationEvents,
    anomalies,
    dataVersion,
    generatedAt: snapshot?.generatedAt ? new Date(snapshot.generatedAt) : null,
    status: snapshot?.status ?? null,
    datasetSourceCount: totalSources,
    onlineDatasetSourceCount: onlineSources,
    portalSourceCount: portalSources.length,
    onlinePortalSourceCount: onlinePortals,
    reachablePortalSourceCount: reachablePortals,
    discoveryCount: discoveries.length,
    hasOfficialData,
    hasRegionalOfficialData: records.some((item) => item.regionCode !== 'CN'),
    hasOfficialPopulationMap: Object.keys(regionalPopulationByName).length === 31,
    regionalPopulationByName,
    regionalPopulationPeriod: latestAnnualPeriod ?? officialCensusPeriods.at(-1) ?? null,
    regionalPopulationHistory,
    officialCensusPeriods,
    officialRegionalPeriods,
    hasHistoricalPopulationMap: officialRegionalPeriods.length >= 2,
  }
}

export function buildOfficialMetricDefinitions(viewModel) {
  const source = '国家统计局公开数据；每条记录保留来源网址、发布时间、采集时间、解析器版本与正式版本号。'
  return {
    total: { name: '年末全国人口', definition: '年度末大陆31个省、自治区、直辖市和现役军人的人口。', unit: '亿人（原始单位：万人）', period: '年度年末口径', comparisonBase: '独立正式版本；不与抽样调查时点合并', source, status: '正式数据' },
    floating: { name: '流动人口', definition: '全国1%人口抽样调查中的流动人口统计值。', unit: '亿人（原始单位：万人）', period: '抽样调查标准时点', comparisonBase: '抽样调查独立数据集', source, status: '调查数据' },
    urbanization: { name: '常住人口城镇化率', definition: '城镇常住人口占年末全国人口的比例。', unit: '%', period: '年度年末口径', comparisonBase: '城镇人口 / 年末全国人口', source, status: '正式数据' },
    aging: { name: '65岁及以上人口占比', definition: '65周岁及以上人口占年末全国人口的比例。', unit: '%', period: '年度年末口径', comparisonBase: '65岁及以上人口 / 年末全国人口', source, status: '正式数据' },
    density: { name: '人口密度', definition: '当前接入的国家统计局正式来源没有直接发布统一人口密度，本平台不自行推算。', unit: '—', period: '—', comparisonBase: '—', source, status: '暂无正式值' },
    coverage: { name: '正式来源在线率', definition: '最近一次检查成功的正式指标数据源数占已配置正式指标数据源数的比例；省级统计门户发现层单独计数，并区分安全连接与降级传输。', unit: '%', period: '实时运行状态', comparisonBase: `${viewModel.onlineDatasetSourceCount}/${viewModel.datasetSourceCount} 个正式来源；省级门户 ${viewModel.reachablePortalSourceCount}/${viewModel.portalSourceCount} 可达`, source: '平台采集与调度状态', status: '运行指标' },
  }
}
