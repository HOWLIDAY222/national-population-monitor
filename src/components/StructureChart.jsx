import { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import echarts from '../lib/echarts'

export default function StructureChart({ province, dataNote }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const option = useMemo(() => {
    const youth = [17.1, 16.9, 16.7, 16.5, 16.3, 16.1, province.age[0]]
    const working = [67.8, 67.6, 67.4, 67.2, 67.0, 66.8, province.age[1]]
    const aging = youth.map((_, index) => +(100 - youth[index] - working[index]).toFixed(1))
    const urban = [64.8, 65.2, 65.7, 66.1, 66.4, 66.7, province.urbanization]

    return {
      animationDuration: reduceMotion ? 0 : 420,
      animationDurationUpdate: reduceMotion ? 0 : 360,
      aria: { enabled: true, decal: { show: false } },
      color: ['#315f86', '#86a9c1', '#d6a35d', '#264d70'],
      tooltip: { trigger: 'axis', backgroundColor: '#17283a', borderWidth: 0, textStyle: { color: '#fff', fontSize: 11 } },
      legend: { top: 1, right: 4, itemWidth: 12, itemHeight: 7, textStyle: { color: '#617386', fontSize: 9 } },
      grid: { left: 36, right: 40, top: 34, bottom: 26 },
      xAxis: {
        type: 'category',
        data: ['2020', '2021', '2022', '2023', '2024', '2025', '当前'],
        axisLine: { lineStyle: { color: '#d8e0e7' } },
        axisTick: { show: false },
        axisLabel: { color: '#718093', fontSize: 9 },
      },
      yAxis: [{
        type: 'value', min: 0, max: 100,
        axisLabel: { color: '#718093', fontSize: 9, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#e8edf2', type: 'dashed' } },
      }, {
        type: 'value', min: 35, max: 100,
        axisLabel: { color: '#718093', fontSize: 9, formatter: '{value}%' },
        splitLine: { show: false },
      }],
      series: [
        { name: '0—14岁', type: 'bar', stack: 'age', barWidth: 22, data: youth },
        { name: '15—64岁', type: 'bar', stack: 'age', data: working },
        { name: '65岁以上', type: 'bar', stack: 'age', data: aging },
        { name: '城镇化率', type: 'line', yAxisIndex: 1, smooth: 0.2, symbolSize: 4, lineStyle: { width: 1.8 }, data: urban },
      ],
    }
  }, [province, reduceMotion])

  return (
    <section className="chart-panel structure-panel" aria-label="年龄与城乡结构">
      <div className="panel-title">
        <div><span>结构观察</span><h2>年龄结构与城乡结构</h2></div>
        <small>{dataNote} · {province.name}</small>
      </div>
      <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate className="structure-chart" />
    </section>
  )
}
