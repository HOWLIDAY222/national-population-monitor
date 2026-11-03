import { Pause, Play, RotateCcw } from 'lucide-react'

export default function ReplayBar({
  period,
  position,
  onPositionChange,
  isReplaying,
  onReplayToggle,
  timeLabel,
  isCruising,
  onCruiseToggle,
  cruiseLabel,
  dataNote,
}) {
  return (
    <section className="replay-bar" aria-label="时间回放与自动巡航">
      <div className="replay-controls">
        <button type="button" className="play-button" onClick={onReplayToggle} aria-label={isReplaying ? '暂停时间回放' : '开始时间回放'}>
          {isReplaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <button type="button" className="reset-button" onClick={() => onPositionChange(100)} aria-label="回到最新时间">
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="replay-track">
        <div className="replay-label"><strong>时间回放</strong><span>{dataNote} · {period}</span></div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={position}
          onChange={(event) => onPositionChange(Number(event.target.value))}
          aria-label="历史时间位置"
          style={{ '--range-progress': `${position}%` }}
        />
        <div className="replay-ticks"><span>起点</span><span>中段</span><span>最新</span></div>
      </div>
      <time className="replay-time">{timeLabel}</time>
      <button type="button" className={`cruise-toggle ${isCruising ? 'active' : ''}`} onClick={onCruiseToggle} aria-pressed={isCruising}>
        <span className="switch"><i /></span>
        <span><strong>自动巡航</strong><small>{isCruising ? cruiseLabel : '已暂停'}</small></span>
      </button>
    </section>
  )
}
