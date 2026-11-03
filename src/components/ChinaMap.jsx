import { useEffect, useMemo, useState } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import echarts from '../lib/echarts'

const palette = ['#eef3f7', '#dbe6ee', '#c3d4e1', '#97b3c9', '#648eae', '#315f86']

const remapSouthSeaPolygon = (polygon) => {
  let maxLatitude = -Infinity
  polygon.forEach((ring) => ring.forEach((point) => {
    maxLatitude = Math.max(maxLatitude, point[1])
  }))
  if (maxLatitude >= 18) return polygon

  return polygon.map((ring) => ring.map(([longitude, latitude, ...rest]) => [
    124.5 + (longitude - 108) * 0.28,
    18.2 + (latitude - 3.3) * 0.28,
    ...rest,
  ]))
}

const createObservationGeoJSON = (geoJSON) => ({
  ...geoJSON,
  features: geoJSON.features.map((feature) => {
    const geometry = feature.geometry
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    const coordinates = polygons.map(remapSouthSeaPolygon)
    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates: geometry.type === 'Polygon' ? coordinates[0] : coordinates,
      },
    }
  }),
})

export default function ChinaMap({ provinces, selectedProvince, onSelect, layer, layers, onLayerChange, dataNote }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [loadNonce, setLoadNonce] = useState(0)
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 650px)').matches)
  const selected = provinces.find((item) => item.name === selectedProvince) ?? provinces[0]

  useEffect(() => {
    const media = window.matchMedia('(max-width: 650px)')
    const handleChange = () => setCompactLayout(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError('')
    fetch(`${import.meta.env.BASE_URL}data/china-provinces.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`地图数据加载失败：${response.status}`)
        return response.json()
      })
      .then((geoJSON) => {
        if (cancelled) return
        echarts.registerMap('china-observation', createObservationGeoJSON(geoJSON))
        setReady(true)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message)
      })
    return () => { cancelled = true }
  }, [loadNonce])

  const activeLayer = layers.find((item) => item.key === layer) ?? layers[0]
  const pieces = useMemo(() => palette.map((color, index) => {
    const low = activeLayer.breaks[index]
    const high = activeLayer.breaks[index + 1]
    if (index === palette.length - 1) return { gte: low, label: `≥ ${low}`, color }
    return { gte: low, lt: high, label: `${low}—<${high}`, color }
  }), [activeLayer])

  const option = useMemo(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return ({
    animationDuration: reduceMotion ? 0 : 450,
    animationDurationUpdate: reduceMotion ? 0 : 420,
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#17283a',
      borderWidth: 0,
      padding: [10, 12],
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: (params) => {
        const item = provinces.find((province) => province.name === params.name)
        if (!item) return params.name
        const value = item[activeLayer.key]
        const metric = Number.isFinite(value) ? `${value} ${activeLayer.unit}` : '暂无数据 · 不参与排名'
        return `<b>${item.name}</b><br/>${activeLayer.label} ${metric}<br/>口径 ${activeLayer.period}<br/>更新于 ${item.updatedMinutes} 分钟前`
      },
    },
    visualMap: {
      type: 'piecewise',
      seriesIndex: 0,
      left: 12,
      bottom: 12,
      itemWidth: 13,
      itemHeight: 9,
      itemGap: 3,
      textStyle: { color: '#66788b', fontSize: 9 },
      pieces,
      outOfRange: { color: '#e3e7ea' },
    },
    series: [{
      name: activeLayer.label,
      type: 'map',
      map: 'china-observation',
      roam: false,
      aspectScale: compactLayout ? 1.05 : 1.35,
      layoutCenter: compactLayout ? ['54%', '50%'] : ['55%', '50%'],
      layoutSize: compactLayout ? '128%' : '220%',
      selectedMode: 'single',
      label: {
        show: true,
        color: '#607486',
        fontSize: compactLayout ? 7 : 10,
        formatter: (params) => params.name.replace(/特别行政区|自治区|省|市|壮族|回族|维吾尔/g, ''),
      },
      labelLayout: { hideOverlap: true },
      itemStyle: { areaColor: '#eef3f7', borderColor: '#ffffff', borderWidth: 1.05 },
      emphasis: {
        label: { show: true, color: '#17283a', fontSize: compactLayout ? 10 : 12, fontWeight: 600 },
        itemStyle: { areaColor: '#7da2be', borderColor: '#fff', borderWidth: 1.3 },
      },
      select: {
        label: { show: true, color: '#fff', fontSize: compactLayout ? 10 : 12, fontWeight: 700 },
        itemStyle: { areaColor: '#315f86', borderColor: '#fff', borderWidth: 1.5 },
      },
      data: provinces.map((province) => ({
        name: province.name,
        value: province[activeLayer.key],
        selected: province.name === selectedProvince,
        itemStyle: Number.isFinite(province[activeLayer.key]) ? undefined : {
          areaColor: '#e3e7ea',
          borderColor: '#ffffff',
          decal: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], color: 'rgba(84, 101, 116, 0.22)' },
        },
      })),
    }],
  })}, [activeLayer, compactLayout, pieces, provinces, selectedProvince])

  return (
    <section className="map-panel" aria-label={`全国${activeLayer.label}地图`}>
      <div className="map-toolbar" role="tablist" aria-label="地图指标图层">
        {layers.map((item, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={layer === item.key}
            className={layer === item.key ? 'active' : ''}
            key={item.key}
            onClick={() => onLayerChange(item.key)}
            data-mobile-layer={index < 3}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="map-canvas">
        {error && (
          <div className="map-loading is-error" role="alert">
            <strong>地图暂时无法加载</strong>
            <span>{error}</span>
            <button type="button" onClick={() => setLoadNonce((value) => value + 1)}>重新加载</button>
          </div>
        )}
        {!error && !ready && <div className="map-loading"><span />正在加载全国地图</div>}
        {ready && (
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            className="china-map"
            onEvents={{ click: (params) => params.name && onSelect(params.name) }}
          />
        )}
      </div>
      <div className="map-footer">
        <span>{dataNote} · 单位：{activeLayer.unit}</span>
        <span className="map-selected"><strong>{selected.name}</strong> {Number.isFinite(selected[activeLayer.key]) ? `${selected[activeLayer.key]} ${activeLayer.unit}` : '暂无数据'}</span>
        <span>点击省份查看观察摘要</span>
      </div>
    </section>
  )
}
