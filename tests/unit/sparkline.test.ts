import { describe, expect, it } from 'vitest'
import { sparklinePath, sparklinePoints } from '@/lib/sparkline'

describe('sparklinePoints', () => {
  it('returns empty for a series without valid values', () => {
    expect(sparklinePoints([null, Number.NaN], 100, 40)).toEqual([])
    expect(sparklinePoints([], 100, 40)).toEqual([])
  })

  it('skips null gaps and distributes valid values left to right', () => {
    const points = sparklinePoints([1, null, 3], 100, 40, 0)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({ x: 0, y: 40 })
    expect(points[1]).toEqual({ x: 100, y: 0 })
  })

  it('keeps a single value horizontally centered', () => {
    const points = sparklinePoints([5], 100, 40, 0)
    expect(points[0]?.x).toBe(50)
    expect(points[0]?.y).toBeGreaterThan(0)
    expect(points[0]?.y).toBeLessThan(40)
  })

  it('keeps a flat series vertically centered without division by zero', () => {
    const points = sparklinePoints([5, 5, 5], 100, 40, 0)
    expect(points).toHaveLength(3)
    for (const point of points) {
      expect(point.y).toBeCloseTo(20)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  })

  it('returns empty for non-positive sizes', () => {
    expect(sparklinePoints([1, 2], 0, 40)).toEqual([])
    expect(sparklinePoints([1, 2], 100, 0)).toEqual([])
  })
})

describe('sparklinePath', () => {
  it('joins points as an SVG points list', () => {
    expect(
      sparklinePath([
        { x: 0, y: 40 },
        { x: 100, y: 0 },
      ]),
    ).toBe('0.0,40.0 100.0,0.0')
  })
})
