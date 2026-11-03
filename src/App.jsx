import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import ChinaMap from './components/ChinaMap'
import MetricStrip from './components/MetricStrip'
import MobileNav from './components/MobileNav'
import ObservationRail from './components/ObservationRail'
import ReplayBar from './components/ReplayBar'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import {
  buildAnomalies,
  buildObservationEvents,
  buildSourceStatus,
  cityProfiles,
  cruiseSteps,
  dataVersion as demoDataVersion,
  defaultCities,
  mapLayers,
  metricDefinitions as demoMetricDefinitions,
  nationalMetrics,
  pageConfigs,
  provinceData,
  trendByPeriod,
} from './data/censusData'
import { buildOfficialMetricDefinitions, buildPopulationViewModel } from './data/populationViewModel'
import { usePopulationPlatform } from './hooks/usePopulationPlatform'

const CompareDrawer = lazy(() => import('./components/CompareDrawer'))
const DataDictionaryDrawer = lazy(() => import('./components/DataDictionaryDrawer'))
const ProvinceObservation = lazy(() => import('./components/ProvinceObservation'))
const StructureChart = lazy(() => import('./components/StructureChart'))
const TrendChart = lazy(() => import('./components/TrendChart'))

const periodDuration = {
  '24小时': 24 * 60 * 60 * 1000,
  '7天': 7 * 24 * 60 * 60 * 1000,
  '30天': 30 * 24 * 60 * 60 * 1000,
}

const routeByPage = {
  态势总览: '#/overview',
  人口分布: '#/distribution',
  结构分析: '#/structure',
  流动监测: '#/flow',
  城镇化观察: '#/urbanization',
  区域对比: '#/compare',
  数据更新状态: '#/data-status',
}
const pageByRoute = Object.fromEntries(Object.entries(routeByPage).map(([page, route]) => [route, page]))
const readPageFromHash = () => pageByRoute[window.location.hash] ?? '态势总览'
const formatDateTime = (date) => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
const formatTime = (date) => date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const fallbackDataTime = new Date(2026, 6, 16, 17, 30)
const regionalPeriodLabel = (value) => {
  if (value === '2010-11-01') return '第六次人口普查'
  if (value === '2020-11-01') return '第七次人口普查'
  return `${value}年省级年度公报`
}

export default function App() {
  const platform = usePopulationPlatform()
  const [activePage, setActivePage] = useState(readPageFromHash)
  const [layer, setLayer] = useState(() => pageConfigs[readPageFromHash()].layer)
  const [selectedProvince, setSelectedProvince] = useState('广东省')
  const [period, setPeriod] = useState('24小时')
  const [replayPosition, setReplayPosition] = useState(100)
  const [isReplaying, setIsReplaying] = useState(false)
  const [isCruising, setIsCruising] = useState(false)
  const [cruiseIndex, setCruiseIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [displayMode, setDisplayMode] = useState('日常观察')
  const [provinceOpen, setProvinceOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(() => readPageFromHash() === '区域对比')
  const [definitionKey, setDefinitionKey] = useState(null)
  const [compareNames, setCompareNames] = useState(['广东省', '山东省', '四川省', '浙江省'])
  const [isSmallViewport, setIsSmallViewport] = useState(() => window.matchMedia('(max-width: 650px)').matches)

  const pauseAutomation = () => {
    setIsCruising(false)
    setIsReplaying(false)
  }

  useEffect(() => {
    if (!pageByRoute[window.location.hash]) window.history.replaceState(null, '', routeByPage.态势总览)
    const syncRoute = () => {
      const nextPage = readPageFromHash()
      pauseAutomation()
      setActivePage(nextPage)
      setLayer(pageConfigs[nextPage].layer)
      setCompareOpen(nextPage === '区域对比')
    }
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    if (!isReplaying) return undefined
    const timer = window.setInterval(() => {
      setReplayPosition((value) => {
        if (value >= 100) {
          setIsReplaying(false)
          return 100
        }
        return Math.min(100, value + 2)
      })
    }, 320)
    return () => window.clearInterval(timer)
  }, [isReplaying])

  useEffect(() => {
    if (!isCruising) return undefined
    const timer = window.setInterval(() => {
      setCruiseIndex((value) => {
        const next = (value + 1) % cruiseSteps.length
        const step = cruiseSteps[next]
        setActivePage(step.page)
        setLayer(step.layer)
        setSelectedProvince(step.province)
        window.history.replaceState(null, '', routeByPage[step.page])
        return next
      })
    }, 4500)
    return () => window.clearInterval(timer)
  }, [isCruising])

  useEffect(() => {
    const restoreMode = () => {
      if (!document.fullscreenElement) setDisplayMode((mode) => mode === '全屏大屏' ? '日常观察' : mode)
    }
    document.addEventListener('fullscreenchange', restoreMode)
    return () => document.removeEventListener('fullscreenchange', restoreMode)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 650px)')
    const syncViewport = () => setIsSmallViewport(media.matches)
    media.addEventListener('change', syncViewport)
    return () => media.removeEventListener('change', syncViewport)
  }, [])

  const rewind = (100 - replayPosition) / 100
  const periodScale = period === '24小时' ? 0.35 : period === '7天' ? 0.7 : 1

  const historicalProvinces = useMemo(() => provinceData.map((item, index) => {
    const regionalFactor = 0.75 + (index % 5) * 0.08
    const historicalOutflow = Number.isFinite(item.outflow)
      ? +(item.outflow + rewind * periodScale * (2 + Math.max(-item.flowChange, 0) * 5)).toFixed(1)
      : null
    return {
      ...item,
      total: Math.round(item.total * (1 - rewind * 0.018 * periodScale * regionalFactor)),
      density: Math.round(item.density * (1 - rewind * 0.015 * periodScale)),
      inflow: +(item.inflow - rewind * periodScale * (4 + Math.max(item.flowChange, 0) * 6)).toFixed(1),
      outflow: historicalOutflow,
      urbanization: +(item.urbanization - rewind * periodScale * item.urbanChange).toFixed(1),
      aging: +(item.aging - rewind * periodScale * 0.2).toFixed(1),
      youth: +(item.youth + rewind * periodScale * 0.1).toFixed(1),
      progress: +(item.progress - rewind * periodScale * 2.8).toFixed(1),
      updatedMinutes: item.updatedMinutes + Math.round(rewind * periodScale * 30),
    }
  }), [periodScale, rewind])

  const officialView = useMemo(
    () => buildPopulationViewModel(platform),
    [platform.snapshot, platform.sources, platform.events, platform.discoveries, platform.regionalHistory, platform.annualRegionalHistory],
  )
  const usingOfficial = platform.mode === 'official' && officialView.hasOfficialData
  const periodOptions = officialView.hasHistoricalPopulationMap
    ? ['24小时', '7天', '30天', '历年']
    : ['24小时', '7天', '30天']
  const isHistoricalRegionalMode = usingOfficial && officialView.hasHistoricalPopulationMap && period === '历年'
  const selectedRegionalIndex = Math.round((replayPosition / 100) * Math.max(officialView.officialRegionalPeriods.length - 1, 0))
  const selectedRegionalPeriod = isHistoricalRegionalMode
    ? officialView.officialRegionalPeriods[selectedRegionalIndex]
    : officialView.regionalPopulationPeriod ?? officialView.officialRegionalPeriods.at(-1) ?? '2020-11-01'
  const selectedRegionalMap = isHistoricalRegionalMode
    ? officialView.regionalPopulationHistory[selectedRegionalPeriod]
    : officialView.regionalPopulationByName
  const selectedRegionalLabel = regionalPeriodLabel(selectedRegionalPeriod)
  const selectedRegionalProvinceTotal = Object.values(selectedRegionalMap ?? {})
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0)
  const lastUpdated = officialView.generatedAt ?? fallbackDataTime
  const displayedProvinces = useMemo(() => {
    if (!usingOfficial || !officialView.hasOfficialPopulationMap) return historicalProvinces
    return historicalProvinces.map((province) => {
      const officialTotal = selectedRegionalMap?.[province.name]
      return Number.isFinite(officialTotal) ? { ...province, total: officialTotal } : province
    })
  }, [historicalProvinces, officialView.hasOfficialPopulationMap, selectedRegionalMap, usingOfficial])
  const fallbackEvents = useMemo(() => buildObservationEvents(displayedProvinces, lastUpdated), [displayedProvinces, lastUpdated])
  const fallbackAnomalies = useMemo(() => buildAnomalies(displayedProvinces), [displayedProvinces])
  const fallbackSourceStatus = useMemo(() => buildSourceStatus(displayedProvinces), [displayedProvinces])
  const liveEvents = usingOfficial ? officialView.events : platform.mode === 'loading' ? [] : fallbackEvents
  const liveAnomalies = usingOfficial ? officialView.anomalies : platform.mode === 'loading' ? [] : fallbackAnomalies
  const liveSourceStatus = usingOfficial ? officialView.sourceStatus : platform.mode === 'loading' ? [] : fallbackSourceStatus
  const selected = displayedProvinces.find((item) => item.name === selectedProvince) ?? displayedProvinces[0]
  const nationalRank = [...displayedProvinces].sort((a, b) => b.total - a.total).findIndex((item) => item.name === selected.name) + 1
  const cities = cityProfiles[selected.name] ?? defaultCities
  const replayTime = isHistoricalRegionalMode
    ? new Date(`${selectedRegionalPeriod.includes('-') ? selectedRegionalPeriod : `${selectedRegionalPeriod}-12-31`}T00:00:00+08:00`)
    : new Date(lastUpdated.getTime() - rewind * (periodDuration[period] ?? periodDuration['30天']))
  const page = pageConfigs[activePage]

  const censusHistoryTrend = useMemo(() => ({
    labels: officialView.officialRegionalPeriods.map((item) => item.slice(0, 4)),
    resident: officialView.officialRegionalPeriods.map((item) => (
      Object.values(officialView.regionalPopulationHistory[item] ?? {}).reduce((sum, value) => sum + value, 0) / 10000
    )),
    floating: [],
    inflow: [],
    outflow: [],
  }), [officialView.officialRegionalPeriods, officialView.regionalPopulationHistory])

  const fallbackMetrics = useMemo(() => nationalMetrics.map((item) => {
    if (replayPosition === 100) return item
    if (item.key === 'total') return { ...item, value: (14.08 - rewind * periodScale * 0.06).toFixed(2), status: '历史回放' }
    if (item.key === 'floating') return { ...item, value: (1.24 - rewind * periodScale * 0.08).toFixed(2), status: '历史回放' }
    if (item.key === 'urbanization') return { ...item, value: (67 - rewind * periodScale * 0.5).toFixed(1), status: '历史回放' }
    if (item.key === 'aging') return { ...item, value: (15.6 - rewind * periodScale * 0.3).toFixed(1), status: '历史回放' }
    if (item.key === 'coverage') return { ...item, value: (99.2 - rewind * periodScale * 2.2).toFixed(1), status: '历史回放' }
    return { ...item, status: '历史回放' }
  }), [periodScale, replayPosition, rewind])
  const historicalMetrics = officialView.metrics.map((item) => item.key === 'total'
    ? {
        ...item,
        label: '31省区市人口合计',
        value: selectedRegionalProvinceTotal ? (selectedRegionalProvinceTotal / 10000).toFixed(2) : '—',
        unit: '亿人',
        change: selectedRegionalPeriod,
        status: `${selectedRegionalLabel} · 正式`,
      }
    : { ...item, value: '—', unit: '', change: '历年回放仅展示省级人口', status: '未混用其他指标口径' })
  const displayedMetrics = platform.mode === 'loading'
    ? nationalMetrics.map((item) => ({ ...item, value: '—', change: '正在读取正式快照', status: '加载中' }))
    : usingOfficial ? isHistoricalRegionalMode ? historicalMetrics : officialView.metrics : fallbackMetrics
  const dataVersion = usingOfficial ? officialView.dataVersion : platform.mode === 'loading'
    ? { id: '正在连接', label: '正式数据加载中', source: '等待人口数据服务响应', status: '加载中', updatedAt: '—' }
    : platform.mode === 'static-demo'
    ? { ...demoDataVersion, label: '公开静态演示版', source: '内置演示数据集', status: '静态演示' }
    : { ...demoDataVersion, label: '演示降级数据', source: '正式接口不可用；演示值未混入正式快照', status: '演示降级' }
  const officialMetricDefinitions = buildOfficialMetricDefinitions(officialView)
  const metricDefinitions = usingOfficial
    ? isHistoricalRegionalMode
      ? Object.fromEntries(Object.entries(officialMetricDefinitions).map(([key, definition]) => key === 'total'
        ? [key, {
            ...definition,
            name: '31省区市人口合计',
            definition: selectedRegionalPeriod.includes('-')
              ? '31个省、自治区、直辖市常住人口之和；普查期保留原公报统计口径。'
              : '31个省、自治区、直辖市年度末常住人口之和；每省数据来自独立正式公报。',
            unit: '亿人（展示前统一换算；原始记录保留发布单位）',
            period: `${selectedRegionalLabel} · ${selectedRegionalPeriod}`,
            comparisonBase: '第六、七次人口普查与省级年度公报分时点对比，不插值',
          }]
        : [key, { ...definition, status: '历年普查回放中未展示', comparisonBase: '不与普查省级人口混用' }]))
      : officialMetricDefinitions
    : demoMetricDefinitions
  const isOfficialPopulationLayer = usingOfficial && officialView.hasOfficialPopulationMap && layer === 'total'
  const regionalDataNote = isOfficialPopulationLayer
    ? `省级正式数据 · ${selectedRegionalLabel} ${selectedRegionalPeriod}${isHistoricalRegionalMode ? '（历年离散回放）' : '（不随高频回放变化）'}`
    : usingOfficial ? '省级演示层 · 不属于正式快照' : platform.mode === 'static-demo' ? '公开静态演示数据' : '演示降级数据'
  const secondaryDataNote = usingOfficial ? '省级演示层 · 不属于正式快照' : platform.mode === 'static-demo' ? '公开静态演示数据' : '演示降级数据'
  const mixedRegionalDataNote = usingOfficial && officialView.hasOfficialPopulationMap
    ? `总人口采用${selectedRegionalLabel}正式数据（${selectedRegionalPeriod}）；其余省市指标为演示数据`
    : platform.mode === 'static-demo' ? '公开静态演示版 · 所有省市指标为演示数据' : '当前为演示降级数据'
  const displayedMapLayers = useMemo(() => mapLayers.map((item) => (
    item.key === 'total' && usingOfficial && officialView.hasOfficialPopulationMap
      ? { ...item, period: `${selectedRegionalLabel} · ${selectedRegionalPeriod}` }
      : item
  )), [officialView.hasOfficialPopulationMap, selectedRegionalLabel, selectedRegionalPeriod, usingOfficial])
  const connectionLabel = usingOfficial
    ? platform.connection === 'live' ? '正式数据 · SSE 已连接' : '正式快照 · SSE 重连中'
    : platform.mode === 'static-demo' ? '公开静态演示版'
    : platform.mode === 'loading' ? '正在连接正式数据' : '演示降级 · 正式接口离线'
  const titleStatus = usingOfficial
    ? `国家级正式数据已接入 · ${regionalDataNote}`
    : platform.mode === 'static-demo' ? '公开静态演示版 · 数据仅用于功能展示'
    : platform.mode === 'loading' ? '正在读取正式数据快照' : '正式接口不可用 · 当前仅显示演示降级数据'

  const handlePageChange = (nextPage) => {
    pauseAutomation()
    setActivePage(nextPage)
    setLayer(pageConfigs[nextPage].layer)
    setCompareOpen(nextPage === '区域对比')
    window.location.hash = routeByPage[nextPage]
  }

  const handleProvinceSelect = (name) => {
    pauseAutomation()
    setSelectedProvince(name)
  }

  const handleLayerChange = (nextLayer) => {
    pauseAutomation()
    setLayer(nextLayer)
    if (nextLayer !== 'total' && period === '历年') {
      setPeriod('30天')
      setReplayPosition(100)
    }
  }

  const handlePeriodChange = (value) => {
    pauseAutomation()
    setPeriod(value)
    if (value === '历年') {
      setActivePage('人口分布')
      setLayer('total')
      window.location.hash = routeByPage.人口分布
    }
    setReplayPosition(100)
  }

  const handleDisplayMode = async (mode) => {
    pauseAutomation()
    if (mode !== '全屏大屏' && document.fullscreenElement) await document.exitFullscreen()
    setDisplayMode(mode)
    if (mode === '全屏大屏' && !document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen() } catch { setDisplayMode('日常观察') }
    }
  }

  const handleFullscreen = async () => {
    pauseAutomation()
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }
    try {
      await document.documentElement.requestFullscreen()
      setDisplayMode('全屏大屏')
    } catch { setDisplayMode('日常观察') }
  }

  const handleMenu = () => {
    pauseAutomation()
    if (window.matchMedia('(max-width: 980px)').matches || displayMode === '移动查看') setSidebarOpen(true)
    else setSidebarCollapsed((value) => !value)
  }

  return (
    <div className={`app-frame mode-${displayMode} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${isCruising ? 'cruise-active' : ''}`} data-version={dataVersion.id} data-platform-mode={platform.mode}>
      <div className="app-shell">
        <Sidebar
          active={activePage}
          onChange={handlePageChange}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          statusLabel={usingOfficial ? '正式来源在线' : platform.mode === 'loading' ? '正在连接数据服务' : '正式接口离线'}
          statusDetail={usingOfficial ? `${officialView.onlineDatasetSourceCount}/${officialView.datasetSourceCount} 正式来源 · 省级门户 ${officialView.reachablePortalSourceCount}/${officialView.portalSourceCount} 可达` : '当前为演示降级'}
          statusTone={usingOfficial ? '' : 'is-warning'}
        />
        {sidebarOpen && <button className="sidebar-backdrop" aria-label="关闭专题导航" onClick={() => setSidebarOpen(false)} />}

        <div className="workspace">
          <Topbar
            provinces={displayedProvinces}
            query={query}
            onQueryChange={setQuery}
            onProvinceSelect={handleProvinceSelect}
            onMenu={handleMenu}
            dataTime={formatDateTime(isHistoricalRegionalMode ? replayTime : usingOfficial ? lastUpdated : replayTime)}
            period={period}
            onPeriodChange={handlePeriodChange}
            periodOptions={periodOptions}
            displayMode={displayMode}
            onDisplayModeChange={handleDisplayMode}
            sourceOpen={sourceOpen}
            onSourceToggle={() => setSourceOpen((value) => !value)}
            sourceStatus={liveSourceStatus}
            dataVersion={dataVersion}
            connectionLabel={connectionLabel}
            connectionState={platform.connection}
            onDefinitionsOpen={() => { setDefinitionKey('total'); setSourceOpen(false) }}
            onFullscreen={handleFullscreen}
          />

          <main className="dashboard">
            <section className="dashboard-title">
              <div>
                <span className="module-question">{page.question}</span>
                <h1><span className="desktop-title">{page.title}</span><span className="mobile-title">{activePage === '态势总览' ? '全国态势' : activePage}</span></h1>
                <p>{page.subtitle}</p>
              </div>
              <div className="mobile-period-switch" aria-label="移动端时间范围">
                {periodOptions.map((item) => (
                  <button type="button" key={item} className={period === item ? 'active' : ''} onClick={() => handlePeriodChange(item)}>{item}</button>
                ))}
              </div>
              <div className="title-status">
                <span><i className={`status-dot ${platform.connection === 'reconnecting' ? 'is-warning' : ''}`} />{titleStatus}</span>
                <span>{isHistoricalRegionalMode ? '统计时点' : usingOfficial ? '快照生成' : '数据时间'} {isHistoricalRegionalMode ? selectedRegionalPeriod : formatTime(usingOfficial ? lastUpdated : replayTime)}</span>
              </div>
            </section>

            <MetricStrip metrics={displayedMetrics} updatedAt={isHistoricalRegionalMode ? selectedRegionalPeriod : formatTime(usingOfficial ? lastUpdated : replayTime)} onOpenDefinition={setDefinitionKey} />

            <div className="primary-grid">
              <ChinaMap
                key={`map-${displayMode}`}
                provinces={displayedProvinces}
                selectedProvince={selectedProvince}
                onSelect={handleProvinceSelect}
                layer={layer}
                layers={displayedMapLayers}
                onLayerChange={handleLayerChange}
                dataNote={regionalDataNote}
              />
              <ObservationRail
                provinces={displayedProvinces}
                selectedProvince={selectedProvince}
                layer={layer}
                layers={displayedMapLayers}
                events={liveEvents}
                anomalies={liveAnomalies}
                dataNote={regionalDataNote}
                eventModeLabel={usingOfficial ? 'SSE 事件流' : '演示事件'}
                onOpenProvince={() => { pauseAutomation(); setProvinceOpen(true) }}
              />
            </div>

            <div className="bottom-grid">
              <Suspense fallback={<section className="chart-panel chart-loading" aria-label="趋势图加载中">正在加载趋势图…</section>}>
                <TrendChart
                  period={period}
                  data={isHistoricalRegionalMode ? censusHistoryTrend : trendByPeriod[period]}
                  focus={activePage}
                  dataNote={isHistoricalRegionalMode ? '第六、七次人口普查与2025年省级年度公报正式数据' : secondaryDataNote}
                />
              </Suspense>
              {!isSmallViewport && displayMode !== '移动查看' && (
                <Suspense fallback={<section className="chart-panel chart-loading" aria-label="结构图加载中">正在加载结构图…</section>}>
                  <StructureChart province={selected} dataNote={secondaryDataNote} />
                </Suspense>
              )}
            </div>

            <ReplayBar
              period={period}
              position={replayPosition}
              onPositionChange={(value) => { pauseAutomation(); setReplayPosition(value) }}
              isReplaying={isReplaying}
              onReplayToggle={() => {
                setIsCruising(false)
                if (replayPosition >= 100) setReplayPosition(0)
                setIsReplaying((value) => !value)
              }}
              timeLabel={formatDateTime(replayTime)}
              isCruising={isCruising}
              onCruiseToggle={() => {
                setIsReplaying(false)
                setReplayPosition(100)
                setIsCruising((value) => !value)
              }}
              cruiseLabel={`巡航：${cruiseSteps[cruiseIndex].label}`}
              dataNote={regionalDataNote}
            />

            <footer className="statusbar">
              <span><i className={`status-dot ${usingOfficial ? '' : 'is-warning'}`} />{usingOfficial ? `${officialView.onlineDatasetSourceCount}/${officialView.datasetSourceCount} 个正式来源在线` : '正式数据服务离线'}</span>
              <span>{usingOfficial ? `待审核 ${officialView.status?.pendingValidation ?? 0} 条` : '省级地图为演示降级层'}</span>
              <span>{dataVersion.status} · {dataVersion.id}</span>
            </footer>
          </main>
          <MobileNav active={activePage} onChange={handlePageChange} />
        </div>
      </div>

      {displayMode === '移动查看' && (
        <button type="button" className="exit-mobile-preview" onClick={() => setDisplayMode('日常观察')}>退出移动预览</button>
      )}

      <Suspense fallback={<div className="drawer-loading">正在加载观察面板…</div>}>
        {provinceOpen && (
          <ProvinceObservation
            province={selected}
            cities={cities}
            nationalRank={nationalRank}
            officialPopulation={usingOfficial && officialView.hasOfficialPopulationMap}
            officialPopulationLabel={`${selectedRegionalLabel}正式数据`}
            officialPopulationPeriod={selectedRegionalPeriod}
            dataNote={mixedRegionalDataNote}
            onClose={() => setProvinceOpen(false)}
            onOpenCompare={() => { setProvinceOpen(false); setCompareOpen(true) }}
          />
        )}

        {compareOpen && (
          <CompareDrawer
            provinces={displayedProvinces}
            selectedNames={compareNames}
            dataNote={mixedRegionalDataNote}
            onAdd={(name) => setCompareNames((items) => items.length < 4 ? [...items, name] : items)}
            onRemove={(name) => setCompareNames((items) => items.length > 2 ? items.filter((item) => item !== name) : items)}
            onClose={() => setCompareOpen(false)}
          />
        )}

        {definitionKey && (
          <DataDictionaryDrawer
            definitions={metricDefinitions}
            dataVersion={dataVersion}
            mapLayers={displayedMapLayers}
            selectedKey={definitionKey}
            onClose={() => setDefinitionKey(null)}
          />
        )}
      </Suspense>
    </div>
  )
}
