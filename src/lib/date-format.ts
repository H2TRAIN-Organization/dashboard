/**
 * European date rendering for the dashboard: day-first `dd/mm/aaaa` in every
 * date the front shows, independent of the selected language. Timestamps keep
 * their time part; short chart labels keep the language-specific month name
 * but day-first. Formatting uses local time, matching the previous
 * `toLocaleDateString` behavior; only the field order changes.
 */

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value)
}

function isValid(value: Date): boolean {
  return !Number.isNaN(value.getTime())
}

/** `dd/mm/aaaa` for a full calendar day. */
export function formatEuropeanDate(value: Date | string | number): string {
  const date = toDate(value)
  if (!isValid(date)) return ''
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`
}

/** `dd/mm/aaaa, HH:mm` for a timestamp. */
export function formatEuropeanDateTime(value: Date | string | number): string {
  const date = toDate(value)
  if (!isValid(date)) return ''
  return `${formatEuropeanDate(date)}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** `16 nov` — day-first short label; the month name follows the language. */
export function formatEuropeanShortDay(
  value: Date | string | number,
  locale: string,
): string {
  const date = toDate(value)
  if (!isValid(date)) return ''
  const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date)
  return `${date.getDate()} ${month}`
}

/**
 * `Wednesday, 16 November 2026` / `miércoles, 16 de noviembre de 2026` —
 * weekday and month names follow the language, the field order is day-first.
 */
export function formatEuropeanFullDate(
  value: Date | string | number,
  locale: string,
): string {
  const date = toDate(value)
  if (!isValid(date)) return ''
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
  const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date)
  const day = date.getDate()
  const year = date.getFullYear()
  return locale.toLowerCase().startsWith('es')
    ? `${weekday}, ${day} de ${month} de ${year}`
    : `${weekday}, ${day} ${month} ${year}`
}
