export const pageConfigs = {
  态势总览: {
    title: '全国人口态势总览',
    subtitle: '持续观察全国人口规模、结构与流动变化',
    question: '全国人口现在处于什么状态？',
    layer: 'density',
  },
  人口分布: {
    title: '全国人口分布观察',
    subtitle: '识别人口规模、密度与空间集聚差异',
    question: '人口主要分布在哪里？',
    layer: 'total',
  },
  结构分析: {
    title: '全国人口结构分析',
    subtitle: '观察年龄、性别与城乡结构的区域差异',
    question: '人口结构正在怎样变化？',
    layer: 'aging',
  },
  流动监测: {
    title: '全国人口流动监测',
    subtitle: '持续观察跨区域流入、流出与热点变化',
    question: '人口正在从哪里流向哪里？',
    layer: 'inflow',
  },
  城镇化观察: {
    title: '全国城镇化观察',
    subtitle: '比较地区城镇化水平与阶段性变化',
    question: '哪些地区城镇化变化最明显？',
    layer: 'urbanization',
  },
  区域对比: {
    title: '跨区域人口对比',
    subtitle: '在统一口径下比较 2—4 个省份的关键差异',
    question: '目标地区之间有哪些核心差异？',
    layer: 'total',
  },
  数据更新状态: {
    title: '全国数据更新状态',
    subtitle: '观察省级汇总进度、接口连通与数据时效',
    question: '哪些地区已经更新，哪些地区需要关注？',
    layer: 'progress',
  },
}

export const mapLayers = [
  { key: 'total', label: '总人口', unit: '万人', period: '当前快照', breaks: [0, 1000, 3000, 5000, 8000, 10000] },
  { key: 'density', label: '人口密度', unit: '人/㎢', period: '当前快照', breaks: [0, 50, 100, 250, 750, 1250] },
  { key: 'inflow', label: '流入强度', unit: '指数', period: '当前时段', breaks: [60, 85, 95, 105, 120, 130] },
  { key: 'outflow', label: '流出强度', unit: '指数', period: '当前时段', breaks: [60, 85, 95, 105, 120, 130] },
  { key: 'urbanization', label: '城镇化率', unit: '%', period: '年度口径', breaks: [35, 50, 60, 70, 80, 88] },
  { key: 'aging', label: '老龄化', unit: '%', period: '年度口径', breaks: [8, 13, 16, 19, 22, 25] },
  { key: 'youth', label: '青年人口', unit: '%', period: '年度口径', breaks: [9, 12, 15, 18, 21, 24] },
  { key: 'progress', label: '更新进度', unit: '%', period: '当前批次', breaks: [90, 95, 97, 98, 99, 99.5] },
]

export const dataVersion = {
  id: 'DEMO-2026-07-16-v1.1',
  label: '前端演示数据',
  updatedAt: '2026年7月16日 17:30',
  source: '本地演示数据集 / 非正式统计数据',
  status: '口径已定义',
}

export const metricDefinitions = {
  total: {
    name: '全国总人口',
    definition: '各省级地区常住人口汇总的当前演示快照。',
    unit: '亿人',
    period: '当前快照，每日更新',
    comparisonBase: '较上一数据日同口径快照',
    source: '省级人口汇总接口（演示）',
    status: '演示数据',
  },
  floating: {
    name: '流动人口存量',
    definition: '当前统计时点内，常住地与现居地不一致的人口存量演示值；不等同于流入强度指数。',
    unit: '亿人',
    period: '当前快照，每日更新',
    comparisonBase: '较上一数据日同口径快照',
    source: '跨区流动汇总接口（演示）',
    status: '演示数据',
  },
  urbanization: {
    name: '城镇化率',
    definition: '城镇常住人口占全部常住人口的比例。',
    unit: '%',
    period: '年度口径，日内展示最近版本',
    comparisonBase: '较上一数据版本，百分点变化',
    source: '省级人口结构汇总（演示）',
    status: '演示数据',
  },
  aging: {
    name: '65岁以上人口占比',
    definition: '65 岁及以上人口占常住人口的比例。',
    unit: '%',
    period: '年度口径，日内展示最近版本',
    comparisonBase: '较上一数据版本，百分点变化',
    source: '省级年龄结构汇总（演示）',
    status: '演示数据',
  },
  density: {
    name: '人口密度',
    definition: '常住人口除以行政区域陆地面积。',
    unit: '人/㎢',
    period: '当前人口版本',
    comparisonBase: '全国省级地区统一面积口径',
    source: '人口汇总与行政区划面积（演示）',
    status: '演示数据',
  },
  coverage: {
    name: '数据覆盖率',
    definition: '当前批次已成功汇总的省级地区数占计划地区数的比例。',
    unit: '%',
    period: '当前汇总批次',
    comparisonBase: '31 个省级地区计划范围',
    source: '数据运行状态接口（演示）',
    status: '演示数据',
  },
}

const province = (name, total, floating, density, urbanization, aging, youth, inflow, outflow, progress, updatedMinutes, flowChange, urbanChange) => ({
  name,
  total,
  floating,
  density,
  urbanization,
  aging,
  youth,
  inflow,
  outflow,
  progress,
  updatedMinutes,
  flowChange,
  urbanChange,
  age: [youth, Math.max(0, +(100 - youth - aging).toFixed(1)), aging],
})

export const provinceData = [
  province('广东省', 12679, 1885, 742, 75.4, 10.8, 18.9, 128, 82, 99.4, 2, 1.8, 0.3),
  province('山东省', 10153, 612, 645, 65.1, 16.1, 15.8, 91, 112, 99.1, 1, 0.4, 0.2),
  province('河南省', 9872, 536, 590, 58.4, 15.4, 18.2, 86, 121, 98.8, 4, -0.2, 0.3),
  province('四川省', 8368, 492, 173, 59.8, 21.7, 15.8, 96, 109, 98.6, 5, 0.6, 0.4),
  province('江苏省', 8526, 1076, 828, 75.0, 17.4, 13.2, 119, 88, 99.3, 3, 1.1, 0.2),
  province('河北省', 7393, 386, 393, 62.8, 19.8, 16.4, 88, 113, 98.2, 8, -0.1, 0.2),
  province('湖南省', 6568, 348, 310, 61.2, 19.9, 17.1, 94, 108, 98.0, 7, 0.3, 0.4),
  province('浙江省', 6627, 1624, 632, 74.2, 14.9, 13.4, 123, 84, 99.5, 2, 1.5, 0.3),
  province('安徽省', 6127, 412, 438, 61.5, 20.2, 16.5, 93, 111, 97.9, 9, 0.2, 0.4),
  province('湖北省', 5838, 456, 314, 65.0, 20.4, 14.9, 105, 97, 98.7, 5, 0.8, 0.3),
  province('广西壮族自治区', 5027, 318, 212, 55.6, 17.9, 21.5, 98, 103, 97.6, 11, 0.5, 0.5),
  province('云南省', 4690, 276, 122, 52.2, 16.7, 19.4, 92, 108, 97.4, 13, 0.2, 0.5),
  province('江西省', 4515, 294, 270, 62.1, 17.8, 18.7, 95, 105, 98.1, 8, 0.4, 0.4),
  province('辽宁省', 4188, 226, 283, 73.0, 26.2, 10.7, 83, 116, 98.9, 6, -0.4, 0.1),
  province('福建省', 4188, 782, 337, 70.1, 16.5, 16.6, 116, 91, 99.0, 4, 1.2, 0.3),
  province('陕西省', 3953, 348, 192, 65.2, 18.8, 16.0, 102, 99, 98.3, 8, 0.7, 0.4),
  province('贵州省', 3856, 248, 219, 54.3, 17.2, 22.0, 90, 111, 97.2, 14, 0.1, 0.6),
  province('山西省', 3468, 212, 222, 64.7, 20.1, 15.5, 84, 117, 97.8, 12, -0.2, 0.2),
  province('重庆市', 3191, 602, 387, 70.7, 22.2, 15.3, 112, 95, 99.1, 4, 0.9, 0.4),
  province('黑龙江省', 3099, 182, 67, 67.8, 24.8, 10.5, 78, 124, 97.5, 16, -0.5, 0.1),
  province('新疆维吾尔自治区', 2587, 216, 16, 58.2, 11.3, 22.4, 104, 101, 96.8, 18, 0.6, 0.6),
  province('甘肃省', 2465, 174, 58, 56.1, 18.9, 18.6, 82, 118, 96.9, 15, -0.3, 0.4),
  province('上海市', 2488, 1064, 3923, 89.3, 25.5, 9.8, 138, 73, 99.7, 1, 2.1, 0.1),
  province('吉林省', 2340, 168, 125, 64.7, 23.1, 11.7, 79, 122, 94.6, 36, -0.6, 0.1),
  province('内蒙古自治区', 2396, 192, 20, 68.2, 20.7, 14.0, 88, 114, 97.1, 17, -0.1, 0.3),
  province('北京市', 2185, 832, 1332, 87.6, 22.6, 11.9, 131, 76, 99.8, 1, 1.4, 0.1),
  province('天津市', 1364, 376, 1141, 85.1, 23.1, 11.4, 117, 88, 99.4, 3, 0.8, 0.1),
  province('海南省', 1043, 288, 295, 62.0, 15.8, 19.2, 110, 93, 98.4, 6, 1.0, 0.5),
  province('宁夏回族自治区', 729, 108, 110, 67.0, 14.7, 21.1, 99, 102, 97.7, 13, 0.3, 0.5),
  province('青海省', 594, 84, 8, 61.4, 13.8, 21.0, 87, 115, 96.5, 20, -0.1, 0.4),
  province('西藏自治区', 366, 51, 3, 39.8, 9.6, 24.5, 93, null, 95.9, 22, 0.2, 0.7),
]

export const nationalMetrics = [
  { key: 'total', label: '全国总人口', value: '14.08', unit: '亿', change: '较上日 +12.6万', status: '持续观察' },
  { key: 'floating', label: '流动人口存量', value: '1.24', unit: '亿', change: '较上日 +1.8%', status: '持续观察' },
  { key: 'urbanization', label: '城镇化率', value: '67.0', unit: '%', change: '+0.3pp', status: '稳定上行' },
  { key: 'aging', label: '65岁以上', value: '15.6', unit: '%', change: '+0.2pp', status: '持续观察' },
  { key: 'density', label: '人口密度', value: '148', unit: '人/㎢', change: '全国平均', status: '口径一致' },
  { key: 'coverage', label: '数据覆盖率', value: '99.2', unit: '%', change: '31/31省级', status: '链路正常' },
]

export const trendByPeriod = {
  '24小时': {
    labels: ['17:30', '21:30', '01:30', '05:30', '09:30', '13:30', '17:30'],
    resident: [140.02, 140.03, 140.04, 140.04, 140.05, 140.06, 140.08],
    floating: [1.14, 1.16, 1.17, 1.18, 1.20, 1.22, 1.24],
    inflow: [96, 101, 98, 104, 109, 116, 124],
    outflow: [103, 100, 102, 99, 97, 95, 93],
  },
  '7天': {
    labels: ['07-10', '07-11', '07-12', '07-13', '07-14', '07-15', '07-16'],
    resident: [139.86, 139.92, 140.01, 140.02, 140.03, 140.05, 140.08],
    floating: [1.18, 1.19, 1.20, 1.21, 1.22, 1.23, 1.24],
    inflow: [98, 101, 103, 102, 108, 116, 124],
    outflow: [106, 104, 101, 102, 98, 95, 93],
  },
  '30天': {
    labels: ['06-17', '06-21', '06-25', '06-29', '07-03', '07-07', '07-11', '07-16'],
    resident: [139.42, 139.55, 139.80, 139.69, 139.88, 140.01, 140.03, 140.08],
    floating: [1.15, 1.16, 1.18, 1.18, 1.19, 1.20, 1.22, 1.24],
    inflow: [92, 95, 97, 101, 105, 108, 116, 124],
    outflow: [110, 108, 106, 103, 101, 98, 95, 93],
  },
}

export const liveDataPulses = [
  { region: '广东省', field: 'inflow', delta: 0.8 },
  { region: '山东省', field: 'progress', delta: 0.9 },
  { region: '上海市', field: 'inflow', delta: 1.4 },
  { region: '四川省', field: 'aging', delta: 0.1 },
  { region: '浙江省', field: 'urbanization', delta: 0.2 },
  { region: '吉林省', field: 'updatedMinutes', delta: 2 },
]

const shortRegion = (name) => name.replace(/省|市|自治区|壮族|回族|维吾尔/g, '')
const formatEventTime = (date) => date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const finiteValues = (provinces, key) => provinces.map((item) => item[key]).filter(Number.isFinite)
const averageOf = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)

export function applyLivePulse(provinces, tick) {
  const pulse = liveDataPulses[tick % liveDataPulses.length]
  return provinces.map((item) => {
    if (item.name !== pulse.region || !Number.isFinite(item[pulse.field])) return { ...item, liveChange: null }
    const rawValue = item[pulse.field] + pulse.delta
    const value = pulse.field === 'progress' ? Math.min(100, rawValue) : rawValue
    const integerFields = new Set(['updatedMinutes', 'total', 'density'])
    return {
      ...item,
      [pulse.field]: integerFields.has(pulse.field) ? Math.round(value) : +value.toFixed(1),
      liveChange: { field: pulse.field, delta: pulse.delta },
    }
  })
}

export function buildObservationEvents(provinces, now) {
  const agingAverage = averageOf(finiteValues(provinces, 'aging'))
  const current = provinces.find((item) => item.liveChange)
  const events = []

  if (current) {
    const region = shortRegion(current.name)
    const field = current.liveChange.field
    if (field === 'progress' && current.progress >= 99.8) {
      events.push({ region, message: '完成省级汇总', tone: 'success', category: '更新', rule: '更新进度 ≥ 99.8%' })
    } else if (field === 'inflow' && current.inflow >= 130) {
      events.push({ region, message: '流入强度进入高位', tone: 'warning', category: '热点', rule: '流入指数 ≥ 130' })
    } else if (field === 'inflow') {
      events.push({ region, message: `流动指数 +${current.flowChange.toFixed(1)}%`, tone: 'info', category: '流动', rule: '流入指数发生增量变化' })
    } else if (field === 'aging') {
      events.push({ region, message: '老龄人口占比更新', tone: current.aging > agingAverage ? 'warning' : 'info', category: '结构', rule: '年龄结构版本更新' })
    } else if (field === 'urbanization') {
      events.push({ region, message: `城镇化率变化 +${current.liveChange.delta.toFixed(1)}pp`, tone: 'info', category: '城镇化', rule: '城镇化变化 ≥ 0.2pp' })
    } else if (field === 'updatedMinutes') {
      events.push({ region, message: `数据已延迟 ${current.updatedMinutes} 分钟`, tone: 'warning', category: '更新', rule: '更新时间延迟 ≥ 30分钟' })
    }
  }

  const thresholdEvents = []
  const flowLeader = provinces.filter((item) => item.total >= 5000 && item.flowChange >= 1.5).sort((a, b) => b.flowChange - a.flowChange)[0]
  const progressLeader = provinces.filter((item) => item.progress >= 99).sort((a, b) => b.progress - a.progress)[0]
  const inflowLeader = provinces.filter((item) => Number.isFinite(item.inflow) && item.inflow >= 130).sort((a, b) => b.inflow - a.inflow)[0]
  const agingLeader = provinces.filter((item) => item.aging >= agingAverage + 5).sort((a, b) => b.aging - a.aging)[0]
  if (flowLeader) thresholdEvents.push({ region: shortRegion(flowLeader.name), message: `流动指数 +${flowLeader.flowChange.toFixed(1)}%`, tone: 'info', category: '流动', rule: '流动变化 ≥ 1.5%' })
  if (progressLeader) thresholdEvents.push({ region: shortRegion(progressLeader.name), message: '省级汇总进度已达标', tone: 'success', category: '更新', rule: '更新进度 ≥ 99%' })
  if (inflowLeader) thresholdEvents.push({ region: shortRegion(inflowLeader.name), message: '流入强度高位', tone: 'warning', category: '热点', rule: '流入指数 ≥ 130' })
  if (agingLeader) thresholdEvents.push({ region: shortRegion(agingLeader.name), message: '65岁以上占比高于全国均值', tone: 'warning', category: '结构', rule: '老龄化率高于均值 5pp' })

  const seen = new Set()
  return [...events, ...thresholdEvents]
    .filter((item) => {
      const key = `${item.region}-${item.category}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 6)
    .map((item, index) => ({ ...item, time: formatEventTime(new Date(now.getTime() - index * 2 * 60 * 1000)) }))
}

export function buildAnomalies(provinces) {
  const agingAverage = averageOf(finiteValues(provinces, 'aging'))
  const inflowAverage = averageOf(finiteValues(provinces, 'inflow'))
  const items = []
  provinces.filter((item) => item.updatedMinutes > 30).forEach((item) => {
    items.push({ region: shortRegion(item.name), message: `数据超过30分钟未更新（${item.updatedMinutes}分钟）`, tone: 'danger', rule: '更新时间延迟 > 30分钟' })
  })
  provinces.filter((item) => Number.isFinite(item.inflow) && item.inflow >= 135).forEach((item) => {
    const delta = ((item.inflow / inflowAverage - 1) * 100).toFixed(1)
    items.push({ region: shortRegion(item.name), message: `流入强度高于全国均值 ${delta}%`, tone: 'warning', rule: '流入指数 ≥ 135' })
  })
  provinces.filter((item) => item.aging >= agingAverage + 6).slice(0, 2).forEach((item) => {
    items.push({ region: shortRegion(item.name), message: '65岁以上人口占比显著高于全国均值', tone: 'warning', rule: '老龄化率高于均值 6pp' })
  })
  return items.slice(0, 4)
}

export function buildSourceStatus(provinces) {
  const stale = provinces.filter((item) => item.updatedMinutes > 30)
  return [
    { name: '省级汇总接口', latency: '86ms', status: '正常' },
    { name: '城市活动接口', latency: '112ms', status: '正常' },
    { name: '跨区流动接口', latency: '139ms', status: '正常' },
    {
      name: stale.length ? `${shortRegion(stale[0].name)}增量链路` : '省级增量链路',
      latency: stale.length ? `${stale[0].updatedMinutes}分` : '94ms',
      status: stale.length ? '延迟' : '正常',
    },
  ]
}

export const cityProfiles = {
  广东省: [
    { name: '广州', population: 1875, inflow: 1.62, urbanization: 86.5, aging: 8.6 },
    { name: '深圳', population: 1767, inflow: 1.78, urbanization: 99.8, aging: 5.9 },
    { name: '东莞', population: 1086, inflow: 1.43, urbanization: 92.2, aging: 6.8 },
    { name: '佛山', population: 961, inflow: 1.21, urbanization: 95.0, aging: 9.2 },
    { name: '惠州', population: 605, inflow: 1.18, urbanization: 72.6, aging: 10.4 },
  ],
  山东省: [
    { name: '临沂', population: 1102, inflow: 0.92, urbanization: 58.2, aging: 17.3 },
    { name: '青岛', population: 1034, inflow: 1.22, urbanization: 78.3, aging: 15.4 },
    { name: '潍坊', population: 941, inflow: 0.86, urbanization: 65.1, aging: 16.8 },
    { name: '济南', population: 941, inflow: 1.08, urbanization: 76.8, aging: 15.9 },
    { name: '菏泽', population: 868, inflow: 0.74, urbanization: 52.4, aging: 16.5 },
  ],
  四川省: [
    { name: '成都', population: 2140, inflow: 1.31, urbanization: 81.6, aging: 16.9 },
    { name: '南充', population: 556, inflow: 0.83, urbanization: 53.1, aging: 23.0 },
    { name: '达州', population: 538, inflow: 0.78, urbanization: 51.9, aging: 22.4 },
    { name: '绵阳', population: 490, inflow: 0.96, urbanization: 60.8, aging: 21.1 },
    { name: '凉山', population: 489, inflow: 0.72, urbanization: 39.4, aging: 14.8 },
  ],
  浙江省: [
    { name: '杭州', population: 1252, inflow: 1.38, urbanization: 84.2, aging: 13.2 },
    { name: '温州', population: 985, inflow: 1.12, urbanization: 75.1, aging: 14.6 },
    { name: '宁波', population: 969, inflow: 1.29, urbanization: 78.9, aging: 14.1 },
    { name: '金华', population: 716, inflow: 1.18, urbanization: 72.0, aging: 15.2 },
    { name: '台州', population: 668, inflow: 1.05, urbanization: 68.7, aging: 16.0 },
  ],
}

export const defaultCities = [
  { name: '中心城区', population: 620, inflow: 1.12, urbanization: 76.3, aging: 14.8 },
  { name: '东部片区', population: 488, inflow: 1.04, urbanization: 68.1, aging: 16.2 },
  { name: '南部片区', population: 416, inflow: 0.96, urbanization: 61.5, aging: 18.1 },
  { name: '西部片区', population: 362, inflow: 0.88, urbanization: 57.2, aging: 19.4 },
  { name: '北部片区', population: 315, inflow: 0.82, urbanization: 53.8, aging: 20.2 },
]

export const cruiseSteps = [
  { label: '全国总览', page: '态势总览', layer: 'density', province: '广东省' },
  { label: '人口分布', page: '人口分布', layer: 'total', province: '山东省' },
  { label: '流动监测', page: '流动监测', layer: 'inflow', province: '上海市' },
  { label: '年龄结构', page: '结构分析', layer: 'aging', province: '辽宁省' },
  { label: '重点省份', page: '态势总览', layer: 'urbanization', province: '广东省' },
]
