import { ArrowLeft, GitCompareArrows, MapPin, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const trendPoints = '0,56 34,48 68,51 102,43 136,37 170,40 204,28 238,22 272,25 306,15'
const historyPoints = '0,62 34,58 68,56 102,54 136,50 170,48 204,45 238,41 272,40 306,35'

export default function ProvinceObservation({ province, cities, nationalRank, officialPopulation, officialPopulationLabel, officialPopulationPeriod, dataNote, onClose, onOpenCompare }) {
  const [selectedCity, setSelectedCity] = useState(cities[0])

  useEffect(() => { setSelectedCity(cities[0]) }, [cities])
  const maxPopulation = Math.max(...cities.map((city) => city.population))

  return (
    <div className="modal-backdrop province-backdrop" role="presentation">
      <section className="province-observation" role="dialog" aria-modal="true" aria-label={`${province.name}人口观察`}>
        <header className="province-header">
          <button type="button" className="back-button" onClick={onClose}><ArrowLeft size={16} />返回全国</button>
          <div className="province-heading">
            <span>省级观察</span>
            <h2>{province.name}人口观察</h2>
            <p>城市分布、流动变化与结构差异</p>
          </div>
          <div className="province-header-actions">
            <div className="province-notices"><span>珠海流入强度较昨日 +2.4%</span><span className="warning">数据延迟地区 1 个</span></div>
            <button type="button" className="compare-action" onClick={onOpenCompare}><GitCompareArrows size={15} />区域对比</button>
            <button type="button" className="icon-close" onClick={onClose} aria-label="关闭省级观察"><X size={18} /></button>
          </div>
        </header>

        <div className="province-body">
          <p className="mixed-data-notice">{dataNote}</p>
          <section className="province-metric-row" aria-label="省级核心指标">
            {[
              ['常住人口', `${(province.total / 10000).toFixed(2)}亿`, officialPopulation ? officialPopulationLabel : `较昨日 +${Math.max(province.flowChange / 10, 0.1).toFixed(1)}%`, officialPopulation ? `标准时点 ${officialPopulationPeriod}` : '17:30更新 · 演示数据'],
              ['流动人口', `${province.floating.toLocaleString('zh-CN')}万`, `较昨日 ${province.flowChange >= 0 ? '+' : ''}${province.flowChange}%`],
              ['城镇化率', `${province.urbanization}%`, `较昨日 +${province.urbanChange}pp`],
              ['65岁以上', `${province.aging}%`, province.aging > 15.6 ? '高于全国均值' : '低于全国均值'],
              ['全国人口排名', `第${nationalRank}`, '31 个省级地区'],
            ].map(([label, value, note, timestamp]) => (
              <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small><em>{timestamp ?? '17:30更新 · 演示数据'}</em></article>
            ))}
          </section>

          <div className="province-main-grid">
            <section className="city-distribution">
              <div className="panel-title"><div><span>城市分布</span><h3>地级市人口分布</h3></div><small>单位：万人</small></div>
              <div className="city-bars">
                {cities.map((city, index) => (
                  <button
                    type="button"
                    className={selectedCity.name === city.name ? 'selected' : ''}
                    key={city.name}
                    onClick={() => setSelectedCity(city)}
                  >
                    <span className="city-rank">{index + 1}</span>
                    <span className="city-name"><MapPin size={13} />{city.name}</span>
                    <span className="city-track"><i style={{ width: `${(city.population / maxPopulation) * 100}%` }} /></span>
                    <strong>{city.population.toLocaleString('zh-CN')}</strong>
                  </button>
                ))}
              </div>
              <div className="city-map-echo" aria-hidden="true">
                {cities.map((city, index) => <i key={city.name} style={{ left: `${18 + index * 16}%`, top: `${42 - (index % 2) * 18}%`, '--size': `${18 + (city.population / maxPopulation) * 22}px` }}><span>{city.name}</span></i>)}
              </div>
            </section>

            <section className="city-observation">
              <div className="panel-title"><div><span>当前城市</span><h3>{selectedCity.name}</h3></div><small>更新于 17:30</small></div>
              <dl>
                <div><dt>常住人口</dt><dd>{selectedCity.population.toLocaleString('zh-CN')} 万人</dd></div>
                <div><dt>流入强度</dt><dd>{selectedCity.inflow.toFixed(2)}</dd></div>
                <div><dt>城镇化率</dt><dd>{selectedCity.urbanization}%</dd></div>
                <div><dt>65岁以上</dt><dd>{selectedCity.aging}%</dd></div>
                <div><dt>较全省人口均值</dt><dd className="is-up">+{((selectedCity.population / (province.total / cities.length) - 1) * 100).toFixed(1)}%</dd></div>
              </dl>
              <div className="national-rank">全国位次 <strong>{nationalRank}</strong><span>/ 31</span></div>
            </section>
          </div>

          <div className="province-chart-grid">
            <MiniTrend title="城市人口趋势" subtitle="历史同期对比" color="#315f86" />
            <MiniTrend title="流入/流出双向趋势" subtitle="过去24小时" color="#4e928f" second />
            <section className="province-mini-chart structure-mini">
              <div className="mini-title"><h3>年龄结构与城乡结构</h3><span>历史同期对比</span></div>
              <div className="stacked-bars">
                {[0, 1, 2, 3, 4, 5].map((item) => (
                  <div key={item}><i style={{ height: `${province.age[0]}%` }} /><i style={{ height: `${province.age[1]}%` }} /><i style={{ height: `${province.age[2]}%` }} /></div>
                ))}
              </div>
              <div className="structure-legend"><span><i />0—14岁</span><span><i />15—64岁</span><span><i />65岁以上</span><strong>城镇 {province.urbanization}%</strong></div>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}

function MiniTrend({ title, subtitle, color, second = false }) {
  return (
    <section className="province-mini-chart">
      <div className="mini-title"><h3>{title}</h3><span>{subtitle}</span></div>
      <svg viewBox="0 0 306 76" role="img" aria-label={title}>
        <line x1="0" y1="18" x2="306" y2="18" /><line x1="0" y1="40" x2="306" y2="40" /><line x1="0" y1="62" x2="306" y2="62" />
        <polyline points={trendPoints} fill="none" stroke={color} strokeWidth="2.2" />
        {second && <polyline points="0,20 34,26 68,22 102,30 136,36 170,42 204,38 238,47 272,44 306,52" fill="none" stroke="#c4864a" strokeWidth="1.8" />}
        {!second && <polyline points={historyPoints} fill="none" stroke="#a9b6c2" strokeWidth="1.4" strokeDasharray="4 4" />}
      </svg>
      <div className="mini-axis"><span>07-15 17:30</span><span>07-16 09:30</span><span>07-16 17:30</span></div>
    </section>
  )
}
