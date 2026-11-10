'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useOptionalLanguage } from '@/contexts/LanguageContext'
import {
  addDays,
  addMonthsClamped,
  buildCalendarDays,
  capitalizeFirst,
  formatDateValue,
  isDateValueInRange,
  isSameDay,
  isSameMonth,
  parseDateValue,
  startOfMonth,
} from './calendar-utils'

export interface CalendarProps {
  /** Any date inside the month currently shown by the calendar. */
  month: Date
  /** Controlled `YYYY-MM-DD` selection; empty means no date chosen. */
  selectedValue?: string
  /** Stable "today" used for highlighting and the Today action. */
  today?: Date
  /** Optional inclusive range used to disable out-of-range days. */
  minValue?: string
  maxValue?: string
  onMonthChange: (month: Date) => void
  onSelect: (value: string) => void
  onClose: () => void
}

function calendarLocale(language: string): string {
  return language === 'en' ? 'en-US' : 'es-ES'
}

/**
 * Accessible month grid shared by the dashboard date controls.
 *
 * The grid always renders six weeks starting on Sunday, preserving the Health
 * Data calendar layout. Arrow keys move by day/week, Home/End move to the
 * week edges, PageUp/PageDown change month and Escape is handled by the
 * popover wrapper. Focus is roving: only the focused day is tabbable.
 */
export default function Calendar({
  month,
  selectedValue = '',
  today,
  minValue,
  maxValue,
  onMonthChange,
  onSelect,
  onClose,
}: CalendarProps) {
  const { language, t } = useOptionalLanguage()
  const [defaultToday] = useState(() => new Date())
  const todayDate = today ?? defaultToday
  const locale = calendarLocale(language)
  const monthLabelId = useId()
  const gridRef = useRef<HTMLDivElement>(null)

  const selectedDate = parseDateValue(selectedValue)
  const selectedLabel = selectedDate ? formatDateValue(selectedDate) : ''
  const todayValue = formatDateValue(todayDate)
  const todayAllowed = isDateValueInRange(todayValue, minValue, maxValue)

  const initialFocus = useMemo(() => {
    if (selectedDate && isSameMonth(selectedDate, month)) return selectedDate
    if (isSameMonth(todayDate, month)) return todayDate
    return startOfMonth(month)
  }, [selectedDate, todayDate, month])

  const [focusedDate, setFocusedDate] = useState(initialFocus)

  const weekDayNames = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = new Date(2024, 0, 7 + index)
        return capitalizeFirst(
          new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
          locale,
        )
      }),
    [locale],
  )

  const weekDayLongNames = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(
          new Date(2024, 0, 7 + index),
        ),
      ),
    [locale],
  )

  const monthLabel = capitalizeFirst(
    new Intl.DateTimeFormat(locale, { month: 'long' }).format(month),
    locale,
  )
  const fullDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'full' }),
    [locale],
  )
  const days = useMemo(() => buildCalendarDays(month), [month])
  const weeks = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) =>
        days.slice(index * 7, index * 7 + 7),
      ),
    [days],
  )

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const target = grid.querySelector<HTMLElement>(
      `[data-date="${formatDateValue(focusedDate)}"]`,
    )
    target?.focus()
  }, [focusedDate, month])

  const clampToRange = (date: Date) => {
    const min = parseDateValue(minValue)
    const max = parseDateValue(maxValue)
    let next = date
    if (min && next.getTime() < min.getTime()) next = min
    if (max && next.getTime() > max.getTime()) next = max
    return next
  }

  const moveFocus = (date: Date) => {
    const next = clampToRange(date)
    setFocusedDate(next)
    if (!isSameMonth(next, month)) {
      onMonthChange(next)
    }
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: Date | null = null

    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(focusedDate, -1)
        break
      case 'ArrowRight':
        next = addDays(focusedDate, 1)
        break
      case 'ArrowUp':
        next = addDays(focusedDate, -7)
        break
      case 'ArrowDown':
        next = addDays(focusedDate, 7)
        break
      case 'Home':
        next = addDays(focusedDate, -focusedDate.getDay())
        break
      case 'End':
        next = addDays(focusedDate, 6 - focusedDate.getDay())
        break
      case 'PageUp':
        next = addMonthsClamped(focusedDate, -1)
        break
      case 'PageDown':
        next = addMonthsClamped(focusedDate, 1)
        break
      default:
        return
    }

    event.preventDefault()
    moveFocus(next)
  }

  const navigateMonth = (direction: -1 | 1) => {
    const next = addMonthsClamped(focusedDate, direction)
    setFocusedDate(next)
    onMonthChange(next)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navigateMonth(-1)}
          aria-label={t.common.previous}
          title={t.common.previous}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>

        <h3
          id={monthLabelId}
          aria-live="polite"
          className="text-base font-semibold text-slate-900"
        >
          {monthLabel} {month.getFullYear()}
        </h3>

        <button
          type="button"
          onClick={() => navigateMonth(1)}
          aria-label={t.common.next}
          title={t.common.next}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-labelledby={monthLabelId}
        onKeyDown={handleGridKeyDown}
        className="grid grid-cols-7 gap-1"
      >
        <div role="row" className="contents">
          {weekDayNames.map((name, index) => (
            <div
              key={`${name}-${index}`}
              role="columnheader"
              aria-label={weekDayLongNames[index]}
              className="flex h-8 items-center justify-center text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              {name}
            </div>
          ))}
        </div>

        {weeks.map((week) => (
          <div
            role="row"
            className="contents"
            key={formatDateValue(week[0] ?? month)}
          >
            {week.map((date) => {
              const value = formatDateValue(date)
              const isSelected = value === selectedLabel
              const isTodayDay = isSameDay(date, todayDate)
              const isOutside = !isSameMonth(date, month)
              const isDisabled = !isDateValueInRange(value, minValue, maxValue)
              const isFocused = isSameDay(date, focusedDate)

              const stateClass = isDisabled
                ? 'cursor-not-allowed text-slate-300'
                : isSelected
                  ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                  : isTodayDay
                    ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300 hover:bg-blue-100'
                    : isOutside
                      ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                      : 'text-slate-700 hover:bg-slate-100'

              return (
                <div
                  key={value}
                  role="gridcell"
                  aria-selected={isSelected}
                  className="flex justify-center"
                >
                  <button
                    type="button"
                    data-date={value}
                    data-outside={isOutside ? 'true' : undefined}
                    aria-label={fullDateFormatter.format(date)}
                    aria-current={isTodayDay ? 'date' : undefined}
                    aria-pressed={isSelected}
                    disabled={isDisabled}
                    tabIndex={isFocused ? 0 : -1}
                    onClick={() => onSelect(value)}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 sm:h-10 sm:w-10 ${stateClass}`}
                  >
                    {date.getDate()}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={() => onSelect(todayValue)}
          disabled={!todayAllowed}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {t.datepicker.today}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {t.datepicker.close}
        </button>
      </div>
    </div>
  )
}
