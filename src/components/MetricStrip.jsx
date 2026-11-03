import { Info } from 'lucide-react'

export default function MetricStrip({ metrics, updatedAt, onOpenDefinition }) {
  return (
    <section className="metric-strip" aria-label="全国人口核心指标">
      {metrics.map((item, index) => (
        <article className={`metric-item metric-${item.key}`} key={item.key} data-mobile-priority={index < 4}>
          <div className="metric-label">
            <span>{item.label}</span>
            <button type="button" onClick={() => onOpenDefinition(item.key)} aria-label={`查看${item.label}口径`}><Info size={12} /></button>
          </div>
          <strong>{item.value}<em>{item.unit}</em></strong>
          <div className="metric-meta">
            <span className={item.change.includes('+') ? 'is-up' : ''}>{item.change}</span>
            <small>快照 {updatedAt} · {item.status}</small>
          </div>
        </article>
      ))}
    </section>
  )
}
