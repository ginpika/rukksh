import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import type { ComposeOption } from 'echarts/core'
import { LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  type GridComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { StatsBucket } from '../api/client'
import { useThemeState } from '../theme/store'

/**
 * 统计页的按日 Token 趋势，按需注册 ECharts 组件以减少体积。
 */

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

type ECOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption
>

// Canvas 需要实际色值。中性色与 rukkshAppearance.css 对齐。
const CHART_COLORS = {
  light: {
    panel: '#ffffff',
    fg: '#1f2328',
    muted: '#656d76',
    line: '#d1d9e0',
    input: '#0969da',
    output: '#1a7f37',
  },
  dark: {
    panel: '#191c1e',
    fg: '#e6edf3',
    muted: '#919c9f',
    line: '#303638',
    input: '#79c0ff',
    output: '#c8ff5f',
  },
}

/** 纵轴刻度：过万折算为「万」，避免长数字挤占绘图区 */
function axisLabel(v: number): string {
  return v >= 10000 ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万` : String(v)
}

export default function StatsTrendChart({ buckets }: { buckets: StatsBucket[] }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const { scheme } = useThemeState()

  const option = useMemo<ECOption>(() => {
    const c = CHART_COLORS[scheme]
    const singleDay = buckets.length === 1
    const unknown = buckets.map(b => Math.max(0, b.totalTokens - b.promptTokens - b.completionTokens))
    const series = (name: string, color: string, data: number[], lineType: 'solid' | 'dashed' | 'dotted'): LineSeriesOption => ({
      id: name,
      name,
      type: 'line',
      smooth: false,
      showSymbol: singleDay,
      symbol: singleDay ? 'circle' : 'none',
      symbolSize: 7,
      lineStyle: { color, type: lineType, width: 2 },
      itemStyle: { color },
      areaStyle: { color, opacity: 0.06 },
      data,
    })
    return {
      backgroundColor: 'transparent',
      grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: c.panel,
        borderColor: c.line,
        axisPointer: { lineStyle: { color: c.muted, opacity: 0.5 } },
        textStyle: { color: c.fg, fontSize: 14 },
        valueFormatter: (v) => Number(v).toLocaleString('zh-CN'),
      },
      legend: {
        top: 0,
        right: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 3,
        textStyle: { color: c.fg, fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: buckets.map(b => b.key),
        axisLine: { lineStyle: { color: c.line } },
        axisTick: { show: false },
        axisLabel: { color: c.muted, fontSize: 12, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: c.line, opacity: 0.7 } },
        axisLabel: { color: c.muted, fontSize: 12, formatter: axisLabel },
      },
      series: [
        series('输入', c.input, buckets.map(b => b.promptTokens), 'dashed'),
        series('输出', c.output, buckets.map(b => b.completionTokens), 'solid'),
        ...(unknown.some(n => n > 0) ? [series('未拆分', c.muted, unknown, 'dotted')] : []),
      ],
    }
  }, [buckets, scheme])
  const latestOption = useRef(option)

  useEffect(() => {
    latestOption.current = option
    // Replace disappeared series while retaining the user's legend selections.
    chartRef.current?.setOption(option, { replaceMerge: ['series'] })
  }, [option])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const updateSize = () => {
      if (!box.clientWidth || !box.clientHeight) return
      if (chartRef.current) {
        chartRef.current.resize()
        return
      }
      const chart = echarts.init(box)
      chartRef.current = chart
      chart.setOption(latestOption.current)
    }
    const ro = new ResizeObserver(updateSize)
    ro.observe(box)
    updateSize()
    return () => {
      ro.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  return <div ref={boxRef} className="h-full w-full" aria-hidden="true" />
}
