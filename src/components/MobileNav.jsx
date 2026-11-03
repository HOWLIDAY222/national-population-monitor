import { ArrowLeftRight, Gauge, MapPinned, RefreshCw } from 'lucide-react'

const items = [
  ['态势总览', '总览', Gauge],
  ['人口分布', '分布', MapPinned],
  ['流动监测', '流动', ArrowLeftRight],
  ['数据更新状态', '更新', RefreshCw],
]

export default function MobileNav({ active, onChange }) {
  return (
    <nav className="mobile-nav" aria-label="移动端导航">
      {items.map(([page, label, Icon]) => (
        <button type="button" className={active === page ? 'active' : ''} key={page} onClick={() => onChange(page)}>
          <Icon size={18} strokeWidth={1.7} /><span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
