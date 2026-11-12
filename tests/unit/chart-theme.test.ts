import { describe, expect, it } from 'vitest'
import {
  CHART_AXIS_LABEL_STYLE,
  CHART_OTHERS_COLOR,
  CHART_SERIES_COLORS,
  seriesColor,
  xAxisLabel,
  yAxisLabel,
} from '@/components/analytics/chart-theme'

describe('chart theme tokens', () => {
  it('keeps the categorical palette within the 8-hue perceptual limit', () => {
    expect(CHART_SERIES_COLORS.length).toBeLessThanOrEqual(8)
    expect(CHART_SERIES_COLORS.length).toBeGreaterThan(0)
    expect(new Set(CHART_SERIES_COLORS).size).toBe(CHART_SERIES_COLORS.length)
  })

  it('exposes a distinct token for the pie "Others" tail', () => {
    expect(CHART_OTHERS_COLOR).not.toBe('')
  })

  it('cycles through the palette for any series index without throwing', () => {
    expect(seriesColor(0)).toBe(CHART_SERIES_COLORS[0])
    expect(seriesColor(7)).toBe(CHART_SERIES_COLORS[7])
    expect(seriesColor(8)).toBe(CHART_SERIES_COLORS[0])
    expect(seriesColor(-1)).toBe(CHART_SERIES_COLORS[7])
  })
})

describe('chart theme axis labels', () => {
  it('builds a rotated inside-left label for the Y axis', () => {
    const label = yAxisLabel('RMSSD (ms)')
    expect(label.angle).toBe(-90)
    expect(label.position).toBe('insideLeft')
    expect(label.value).toBe('RMSSD (ms)')
    expect(label.style).toEqual(expect.objectContaining(CHART_AXIS_LABEL_STYLE))
  })

  it('builds an inside-bottom label for the X axis', () => {
    const label = xAxisLabel('Fechas')
    expect(label.position).toBe('insideBottom')
    expect(label.offset).toBe(-5)
    expect(label.value).toBe('Fechas')
    expect(label.style).toEqual(expect.objectContaining(CHART_AXIS_LABEL_STYLE))
  })
})
