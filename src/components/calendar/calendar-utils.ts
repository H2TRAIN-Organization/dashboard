/**
 * Date-only helpers shared by the dashboard calendars.
 *
 * Every value crosses component boundaries as a `YYYY-MM-DD` string and is
 * converted with local Date constructors, never with UTC parsing. That keeps
 * the selected day stable for users in any timezone.
 */

const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(value: number) {
  return String(value).padStart(2, '0')
}

/** Format a local Date as the `YYYY-MM-DD` value used by the controls. */
export function formatDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Parse a strict `YYYY-MM-DD` value into a local Date. */
export function parseDateValue(
  value: string | null | undefined,
): Date | null {
  if (!value) return null
  const match = DATE_VALUE_PATTERN.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  // Reject impossible dates such as 2026-02-31 instead of letting Date roll
  // them into the following month.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return date
}

export function isDateValue(value: string): boolean {
  return parseDateValue(value) !== null
}

/** Start of the month in local time; used as the calendar's page key. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

export function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

/** Shift months keeping the day when possible and clamping to month length. */
export function addMonthsClamped(date: Date, amount: number): Date {
  const targetMonth = new Date(
    date.getFullYear(),
    date.getMonth() + amount,
    1,
  )
  const day = Math.min(getDaysInMonth(targetMonth), date.getDate())
  return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day)
}

export function isSameDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

export function isSameMonth(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth()
  )
}

/**
 * Build the six-week grid used by the calendar. The first cell is the Sunday
 * on or before the first day of the month, so the weekday order matches the
 * Sunday-first weekday labels.
 */
export function buildCalendarDays(month: Date): Date[] {
  const firstOfMonth = startOfMonth(month)
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay())
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

/** Localized display text for a stored `YYYY-MM-DD` value. */
export function formatDisplayDateValue(
  value: string,
  locale: string,
): string | null {
  const date = parseDateValue(value)
  if (!date) return null
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** True when the value is valid and inside the optional inclusive range. */
export function isDateValueInRange(
  value: string,
  minValue?: string,
  maxValue?: string,
): boolean {
  const date = parseDateValue(value)
  if (!date) return false

  const min = parseDateValue(minValue)
  if (min && date.getTime() < min.getTime()) return false

  const max = parseDateValue(maxValue)
  if (max && date.getTime() > max.getTime()) return false

  return true
}

export function capitalizeFirst(value: string, locale: string): string {
  return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1)
}
