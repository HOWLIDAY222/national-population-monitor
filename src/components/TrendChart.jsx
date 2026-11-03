import { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import echarts from '../lib/echarts'

export default function TrendChart({ period, data, focus, dataNote }) {
  const isCensusHistory = period === '历年'
  const isFlow = focus === '流动监测' && !isCensusHistory
  const seriesA = isFlow ? data.inflow : data.resident
  const seriesB = isFlow ? data.outflow : data.floating
  const names = isCensusHistory ? ['31省区市人口合计'] : isFlow ? ['流入指数', '流出指数'] : ['全国总人口', '流动人口存量']
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const option = useMemo(() => ({
    animationDuration: reduceMotion ? 0 : 420,
    animationDurationUpdate: reduceMotion ? 0 : 360,
    aria: { enabled: true, decal: { show: false } },
    color: ['#315f86', '#6aa1a0'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#17283a',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 11 },
    },
    legend: {
      top: 1,
      right: 4,
      itemWidth: 18,
      itemHeight: 3,
      textStyle: { color: '#617386', fontSize: 10 },
    },
    grid: { left: 42, right: 42, top: 34, bottom: 26 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data.labels,
      axisLine: { lineStyle: { color: '#d8e0e7' } },
      axisTick: { show: false },
      axisLabel: { color: '#718093', fontSize: 9, margin: 9 },
    },
    yAxis: [{
      type: 'value',
      scale: true,
      axisLabel: { color: '#718093', fontSize: 9 },
      splitLine: { lineStyle: { color: '#e8edf2', type: 'dashed' } },
    }, {
      type: 'value',
      scale: true,
      axisLabel: { color: '#718093', fontSize: 9 },
      splitLine: { show: false },
    }],
    series: [{
      name: names[0],
      type: 'line',
      smooth: 0.25,
      symbolSize: 4,
      lineStyle: { width: 2 },
      data: seriesA,
    }, ...(!isCensusHistory ? [{
      name: names[1],
      type: 'line',
      yAxisIndex: 1,
      smooth: 0.25,
      symbolSize: 4,
      lineStyle: { width: 1.7, type: isFlow ? 'solid' : 'dashed' },
      data: seriesB,
    }] : [])],
  }), [data, isCensusHistory, isFlow, names, reduceMotion, seriesA, seriesB])

  return (
    <section className="chart-panel trend-panel" aria-label={`${period}${isFlow ? '人口流动' : '人口规模'}趋势`}>
      <div className="panel-title">
        <div><span>趋势观察</span><h2>{isCensusHistory ? '普查人口历史对比' : isFlow ? '流入与流出趋势' : '人口与流动趋势'}</h2></div>
        <small>{dataNote} · {period}</small>
      </div>
      <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate className="trend-chart" />
    </section>
  )
}
