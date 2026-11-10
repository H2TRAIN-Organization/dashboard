import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CalendarDateField from '@/components/calendar/CalendarDateField'
import {
  addDays,
  addMonthsClamped,
  buildCalendarDays,
  formatDateValue,
  getDaysInMonth,
  isDateValueInRange,
  isSameDay,
  isSameMonth,
  parseDateValue,
  startOfMonth,
} from '@/components/calendar/calendar-utils'

describe('calendar date values', () => {
  it('formats and parses date-only values without a UTC shift', () => {
    const date = new Date(2026, 0, 2, 23, 59, 59)
    expect(formatDateValue(date)).toBe('2026-01-02')
    expect(parseDateValue('2026-01-02')).toEqual(new Date(2026, 0, 2))
    expect(parseDateValue(formatDateValue(date))).toEqual(
      new Date(2026, 0, 2),
    )
  })

  it('rejects malformed and impossible dates', () => {
    expect(parseDateValue('')).toBeNull()
    expect(parseDateValue('2026-1-2')).toBeNull()
    expect(parseDateValue('02/01/2026')).toBeNull()
    expect(parseDateValue('2026-02-29')).toBeNull()
    expect(parseDateValue('2026-13-01')).toBeNull()
    expect(parseDateValue('2026-04-31')).toBeNull()
  })
})

describe('calendar month helpers', () => {
  it('clamps month navigation to the target month length', () => {
    expect(formatDateValue(addMonthsClamped(new Date(2026, 0, 31), 1))).toBe(
      '2026-02-28',
    )
    expect(formatDateValue(addMonthsClamped(new Date(2024, 0, 31), 1))).toBe(
      '2024-02-29',
    )
    expect(formatDateValue(addMonthsClamped(new Date(2026, 2, 31), -1))).toBe(
      '2026-02-28',
    )
  })

  it('builds six Sunday-first weeks covering the whole month', () => {
    const month = new Date(2026, 10, 9)
    const days = buildCalendarDays(month)

    expect(days).toHaveLength(42)
    expect(days[0]?.getDay()).toBe(0)
    expect(formatDateValue(days[0]!)).toBe('2026-11-01')
    expect(formatDateValue(days[41]!)).toBe('2026-12-12')
    expect(days.filter((day) => isSameMonth(day, month))).toHaveLength(
      getDaysInMonth(month),
    )
  })

  it('keeps local day and month comparisons stable', () => {
    const late = new Date(2026, 10, 9, 23, 30)
    const early = new Date(2026, 10, 9, 0, 15)

    expect(isSameDay(late, early)).toBe(true)
    expect(isSameMonth(late, startOfMonth(late))).toBe(true)
    expect(isSameDay(addDays(late, 1), early)).toBe(false)
  })

  it('treats optional date ranges as inclusive', () => {
    expect(isDateValueInRange('2026-10-01')).toBe(true)
    expect(isDateValueInRange('2026-10-01', '2026-10-01', '2026-10-31')).toBe(
      true,
    )
    expect(isDateValueInRange('2026-10-31', '2026-10-01', '2026-10-31')).toBe(
      true,
    )
    expect(isDateValueInRange('2026-09-30', '2026-10-01', '2026-10-31')).toBe(
      false,
    )
    expect(isDateValueInRange('2026-11-01', '2026-10-01', '2026-10-31')).toBe(
      false,
    )
    expect(isDateValueInRange('not-a-date', '2026-10-01')).toBe(false)
  })
})

describe('reusable calendar date field', () => {
  it('keeps the caller input id, date type and controlled value', () => {
    const markup = renderToStaticMarkup(
      createElement(CalendarDateField, {
        id: 'kubios-date-from',
        label: 'Desde',
        value: '2026-10-01',
        min: '2026-01-01',
        max: '2026-12-31',
        onChange: () => {},
      }),
    )

    expect(markup).toContain('id="kubios-date-from"')
    expect(markup).toContain('type="date"')
    expect(markup).toContain('value="2026-10-01"')
    expect(markup).toContain('min="2026-01-01"')
    expect(markup).toContain('max="2026-12-31"')
    expect(markup).toContain('for="kubios-date-from"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('aria-expanded="false"')
  })
})
