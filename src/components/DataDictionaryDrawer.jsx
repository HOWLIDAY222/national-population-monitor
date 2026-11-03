import { BookOpenCheck, X } from 'lucide-react'

export default function DataDictionaryDrawer({ definitions, dataVersion, mapLayers, selectedKey, onClose }) {
  const entries = Object.entries(definitions)

  return (
    <aside className="data-dictionary-drawer" role="dialog" aria-modal="false" aria-label="指标口径与数据版本">
      <header>
        <div><span>数据审计</span><h2>指标口径与版本</h2><p>统一查看统计单位、周期、基准、来源与状态</p></div>
        <button type="button" className="icon-close" onClick={onClose} aria-label="关闭指标口径"><X size={18} /></button>
      </header>

      <section className="version-block" aria-label="当前数据版本">
        <BookOpenCheck size={18} />
        <div><span>{dataVersion.label}</span><strong>{dataVersion.id}</strong><small>{dataVersion.source}</small></div>
        <em>{dataVersion.status}</em>
      </section>

      <div className="definition-list">
        {entries.map(([key, item]) => (
          <article id={`metric-definition-${key}`} className={selectedKey === key ? 'selected' : ''} key={key}>
            <div className="definition-title"><h3>{item.name}</h3><span>{item.status}</span></div>
            <p>{item.definition}</p>
            <dl>
              <div><dt>统计单位</dt><dd>{item.unit}</dd></div>
              <div><dt>统计周期</dt><dd>{item.period}</dd></div>
              <div><dt>比较基准</dt><dd>{item.comparisonBase}</dd></div>
              <div><dt>数据来源</dt><dd>{item.source}</dd></div>
              <div><dt>更新时间</dt><dd>{dataVersion.updatedAt}</dd></div>
            </dl>
          </article>
        ))}
      </div>

      <section className="layer-dictionary">
        <div className="definition-title"><h3>地图图层口径</h3><span>8 个图层</span></div>
        {mapLayers.map((layer) => (
          <div className="layer-definition" key={layer.key}>
            <strong>{layer.label}</strong><span>{layer.unit}</span><span>{layer.period}</span><small>{layer.breaks.slice(0, -1).join(' / ')} / ≥{layer.breaks.at(-1)}</small>
          </div>
        ))}
        <p className="missing-note"><i />灰色斜纹表示当前图层暂无数据，不参与排名和全国平均计算。</p>
      </section>
    </aside>
  )
}
