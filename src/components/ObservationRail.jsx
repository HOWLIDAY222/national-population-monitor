import { ArrowRight, CircleAlert, RadioTower, RefreshCw } from 'lucide-react'

export default function ObservationRail({
  provinces,
  selectedProvince,
  layer,
  layers,
  events,
  anomalies,
  onOpenProvince,
  dataNote,
  eventModeLabel,
}) {
  const selected = provinces.find((item) => item.name === selectedProvince) ?? provinces[0]
  const activeLayer = layers.find((item) => item.key === layer) ?? layers[0]
  const values = provinces.map((item) => item[layer]).filter(Number.isFinite)
  const ranked = provinces.filter((item) => Number.isFinite(item[layer])).sort((a, b) => b[layer] - a[layer]).slice(0, 5)
  const rank = [...provinces].sort((a, b) => b.total - a.total).findIndex((item) => item.name === selected.name) + 1
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  const hasSelectedValue = Number.isFinite(selected[layer])
  const difference = hasSelectedValue ? selected[layer] - average : null
  const differenceLabel = !hasSelectedValue ? '暂无数据' : activeLayer.unit === '%'
    ? `${difference >= 0 ? '+' : ''}${difference.toFixed(1)}pp`
    : `${difference >= 0 ? '+' : ''}${((difference / Math.max(average, 1)) * 100).toFixed(1)}%`

  return (
    <aside className="observation-rail" aria-label="区域观察摘要">
      <section className="rail-section ranking-section">
        <div className="rail-heading">
          <div><span className="eyeline">{dataNote}</span><h2>{activeLayer.label}前 5</h2></div>
          <small>{activeLayer.unit}</small>
        </div>
        <ol className="ranking-list">
          {ranked.map((item, index) => (
            <li key={item.name} className={item.name === selected.name ? 'selected' : ''}>
              <span>{index + 1}</span><strong>{item.name.replace(/省|市|自治区|壮族|回族|维吾尔/g, '')}</strong><em>{item[layer]}</em>
            </li>
          ))}
        </ol>
      </section>

      <section className="rail-section selected-region">
        <div className="rail-heading"><div><span className="eyeline">当前观察</span><h2>{selected.name}</h2></div><small>{selected.updatedMinutes} 分钟前</small></div>
        <dl>
          <div><dt>常住人口</dt><dd>{selected.total.toLocaleString('zh-CN')} 万人</dd></div>
          <div><dt>全国人口排名</dt><dd>第 {rank}</dd></div>
          <div><dt>较全国平均</dt><dd className={hasSelectedValue && difference >= 0 ? 'is-up' : ''}>{differenceLabel}</dd></div>
        </dl>
        <button type="button" className="text-action" onClick={onOpenProvince}>展开省级观察 <ArrowRight size={14} /></button>
      </section>

      <section className="rail-section realtime-section">
        <div className="rail-heading"><div><span className="eyeline"><RadioTower size={12} />实时观察</span><h2>最新变化</h2></div><small>{eventModeLabel}</small></div>
        <div className="event-list" aria-live="polite">
          {events.slice(0, 4).map((event, index) => (
            <div className={`event-row tone-${event.tone}`} key={`${event.region}-${event.message}-${index}`} title={`触发规则：${event.rule}`}>
              <time>{event.time}</time>
              <span><strong>{event.region}</strong>{event.message}<small>规则：{event.rule}</small></span>
            </div>
          ))}
        </div>
      </section>

      <section className="rail-section anomaly-section">
        <div className="rail-heading"><div><span className="eyeline"><CircleAlert size={12} />异常提醒</span><h2>需要留意</h2></div><small>{anomalies.length} 项</small></div>
        {anomalies.slice(0, 2).map((item) => (
          <div className={`anomaly-row tone-${item.tone}`} key={`${item.region}-${item.message}`} title={`触发规则：${item.rule}`}>
            <span>{item.region}</span><p>{item.message}</p>
          </div>
        ))}
        <div className="update-pulse"><RefreshCw size={13} /><span>{provinces.filter((item) => item.updatedMinutes <= 10).length} 个地区 10 分钟内更新</span></div>
      </section>
    </aside>
  )
}
