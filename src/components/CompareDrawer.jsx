import { Plus, X } from 'lucide-react'

const metrics = [
  { key: 'total', label: '总人口', unit: '万人' },
  { key: 'urbanization', label: '城镇化率', unit: '%' },
  { key: 'aging', label: '65岁以上', unit: '%' },
  { key: 'inflow', label: '流入指数', unit: '' },
]
const colors = ['#315f86', '#5e88a8', '#4e928f', '#c88742']

export default function CompareDrawer({ provinces, selectedNames, dataNote, onAdd, onRemove, onClose }) {
  const selected = selectedNames.map((name) => provinces.find((item) => item.name === name)).filter(Boolean)
  const available = provinces.filter((item) => !selectedNames.includes(item.name))

  return (
    <aside className="compare-drawer" role="dialog" aria-modal="false" aria-label="区域对比">
      <header>
        <div><span>统一口径</span><h2>区域对比</h2><p>选择 2—4 个省份观察核心差异</p></div>
        <button type="button" className="icon-close" onClick={onClose} aria-label="收起区域对比"><X size={18} /></button>
      </header>

      <p className="mixed-data-notice">{dataNote}</p>
      <div className="compare-selected">
        <div className="compare-count"><span>已选省份（最多4个）</span><strong>{selected.length} / 4</strong></div>
        <div className="selected-tags">
          {selected.map((item) => (
            <span key={item.name}>{item.name.replace(/省|市|自治区|壮族|回族|维吾尔/g, '')}<button type="button" disabled={selected.length <= 2} onClick={() => onRemove(item.name)} aria-label={`移除${item.name}`}><X size={12} /></button></span>
          ))}
        </div>
        <label className="compare-add">
          <Plus size={14} />
          <select value="" disabled={selected.length >= 4} onChange={(event) => event.target.value && onAdd(event.target.value)}>
            <option value="">搜索添加省份</option>
            {available.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}
          </select>
        </label>
      </div>

      <div className="compare-legend">
        {selected.map((item, index) => <span key={item.name}><i style={{ background: colors[index] }} />{item.name.replace(/省|市|自治区|壮族|回族|维吾尔/g, '')}</span>)}
      </div>

      <div className="compare-metrics">
        {metrics.map((metric) => {
          const max = Math.max(...selected.map((item) => item[metric.key]), 1)
          return (
            <section key={metric.key}>
              <div className="compare-metric-title"><h3>{metric.label}</h3><span>{metric.unit}</span></div>
              {selected.map((item, index) => (
                <div className="compare-bar" key={item.name}>
                  <span>{item.name.replace(/省|市|自治区|壮族|回族|维吾尔/g, '')}</span>
                  <i><b style={{ width: `${(item[metric.key] / max) * 100}%`, background: colors[index] }} /></i>
                  <strong>{item[metric.key].toLocaleString('zh-CN')}</strong>
                </div>
              ))}
            </section>
          )
        })}
      </div>

      <button type="button" className="collapse-compare" onClick={onClose}>收起对比</button>
    </aside>
  )
}
