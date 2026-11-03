import {
  ArrowLeftRight,
  Building2,
  ChartNoAxesCombined,
  CircleGauge,
  GitCompareArrows,
  MapPinned,
  RefreshCw,
} from 'lucide-react'

const items = [
  ['态势总览', CircleGauge],
  ['人口分布', MapPinned],
  ['结构分析', ChartNoAxesCombined],
  ['流动监测', ArrowLeftRight],
  ['城镇化观察', Building2],
  ['区域对比', GitCompareArrows],
  ['数据更新状态', RefreshCw],
]

export default function Sidebar({ active, onChange, open, onClose, statusLabel, statusDetail, statusTone }) {
  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="专题导航">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <span><strong>全国人口态势</strong><small>人口统计观察平台</small></span>
      </div>
      <nav className="side-nav">
        {items.map(([label, Icon]) => (
          <button
            type="button"
            className={active === label ? 'active' : ''}
            key={label}
            onClick={() => {
              onChange(label)
              onClose()
            }}
            aria-current={active === label ? 'page' : undefined}
          >
            <Icon size={18} strokeWidth={1.75} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className={`status-dot ${statusTone ?? ''}`} />
        <div><strong>{statusLabel}</strong><small>{statusDetail}</small></div>
      </div>
    </aside>
  )
}
