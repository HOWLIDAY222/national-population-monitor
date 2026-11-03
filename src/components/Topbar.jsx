import {
  CalendarClock,
  DatabaseZap,
  Maximize2,
  Menu,
  Search,
  X,
} from 'lucide-react'

const displayModes = ['日常观察', '全屏大屏', '领导汇报', '移动查看']

export default function Topbar({
  provinces,
  query,
  onQueryChange,
  onProvinceSelect,
  onMenu,
  dataTime,
  period,
  onPeriodChange,
  periodOptions,
  displayMode,
  onDisplayModeChange,
  sourceOpen,
  onSourceToggle,
  sourceStatus,
  dataVersion,
  connectionLabel,
  connectionState,
  onDefinitionsOpen,
  onFullscreen,
}) {
  const normalized = query.trim()
  const suggestions = normalized
    ? provinces.filter((item) => item.name.includes(normalized)).slice(0, 6)
    : []

  return (
    <header className="topbar">
      <button className="top-icon menu-button" type="button" onClick={onMenu} aria-label="打开专题导航">
        <Menu size={20} strokeWidth={1.8} />
      </button>
      <div className="mobile-brand">全国人口态势</div>

      <div className="search-wrap">
        <Search size={17} strokeWidth={1.8} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索省份、城市或指标"
          aria-label="搜索省份、城市或指标"
        />
        {query && (
          <button type="button" aria-label="清空搜索" onClick={() => onQueryChange('')}>
            <X size={15} />
          </button>
        )}
        {suggestions.length > 0 && (
          <div className="search-results" role="listbox" aria-label="地区搜索结果">
            {suggestions.map((province) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={province.name}
                onClick={() => {
                  onProvinceSelect(province.name)
                  onQueryChange('')
                }}
              >
                <span className="search-pin" />
                <span>{province.name}</span>
                <small>更新 {province.updatedMinutes} 分钟前</small>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="topbar-spacer" />

      <div className="data-time" title="当前正式快照或回放时间">
        <CalendarClock size={16} strokeWidth={1.7} />
        <span>{dataTime}</span>
      </div>

      <div className="period-switch top-period" aria-label="时间范围">
        {periodOptions.map((item) => (
          <button
            type="button"
            key={item}
            className={period === item ? 'active' : ''}
            aria-pressed={period === item}
            onClick={() => onPeriodChange(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="source-wrap">
        <button
          className="source-button"
          type="button"
          aria-expanded={sourceOpen}
          onClick={onSourceToggle}
        >
          <DatabaseZap size={16} strokeWidth={1.75} />
          <span className={`status-dot ${connectionState === 'reconnecting' ? 'is-warning' : connectionState === 'offline' ? 'is-danger' : ''}`} />
          <span>{connectionLabel}</span>
        </button>
        {sourceOpen && (
          <div className="source-popover">
            <div className="popover-heading"><strong>数据来源状态</strong><small>{dataVersion.id}</small></div>
            <div className="demo-version">
              <span>{dataVersion.label}</span>
              <small>{dataVersion.source}</small>
              <button type="button" onClick={onDefinitionsOpen}>查看指标口径与版本</button>
            </div>
            {sourceStatus.map((item) => (
              <div className="source-row" key={item.name}>
                <span className={`status-dot ${item.status === '延迟' || item.status === '待首检' ? 'is-warning' : item.status === '失败' ? 'is-danger' : ''}`} />
                <span>{item.name}</span>
                <small>{item.latency}</small>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="display-mode">
        <span className="sr-only">展示模式</span>
        <select value={displayMode} onChange={(event) => onDisplayModeChange(event.target.value)}>
          {displayModes.map((mode) => <option value={mode} key={mode}>{mode}</option>)}
        </select>
      </label>

      <button className="top-icon fullscreen-button" type="button" onClick={onFullscreen} aria-label="进入全屏">
        <Maximize2 size={18} strokeWidth={1.75} />
      </button>
    </header>
  )
}
