'use client'

import { useId, useRef, useState } from 'react'
import {
  Calendar as CalendarIcon,
  ChevronDown,
  X,
} from 'lucide-react'
import { useOptionalLanguage } from '@/contexts/LanguageContext'
import Calendar from './Calendar'
import CalendarPopup from './CalendarPopup'
import { parseDateValue } from './calendar-utils'
import { useCalendarPopover } from './useCalendarPopover'

export interface CalendarDateFieldProps {
  /** Input id; kept on the native date input for label and test stability. */
  id: string
  label: string
  /** Controlled `YYYY-MM-DD` value. Empty string means no date. */
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  /** Show an inline clear action. Native keyboard clearing still works. */
  clearable?: boolean
  className?: string
  inputClassName?: string
}

/**
 * Reusable controlled date field for range filters such as Kubios.
 *
 * The native `type="date"` input keeps the existing typed-date and clear
 * behaviour plus the original input id. A separate trigger opens the shared
 * accessible calendar, which returns the same `YYYY-MM-DD` value through
 * `onChange`.
 */
export default function CalendarDateField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  disabled = false,
  clearable = true,
  className,
  inputClassName,
}: CalendarDateFieldProps) {
  const { t } = useOptionalLanguage()
  const [defaultToday] = useState(() => new Date())
  const generatedId = useId()
  const dialogId = `${id}-calendar-dialog`
  const [month, setMonth] = useState(() => parseDateValue(value) ?? defaultToday)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const { isOpen, position, open, close, handlePopupKeyDown } =
    useCalendarPopover(anchorRef, popupRef)
  const labelId = generatedId

  const handleTriggerClick = () => {
    if (isOpen) {
      close(false)
      return
    }
    setMonth(parseDateValue(value) ?? defaultToday)
    open()
  }

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    close(true)
  }

  const handleClear = () => {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={className}>
      <label
        id={labelId}
        htmlFor={id}
        className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600"
      >
        {label}
      </label>
      <div className="relative">
        <CalendarIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={id}
          type="date"
          value={value}
          min={min || undefined}
          max={max || undefined}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-labelledby={labelId}
          className={`w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 text-sm font-medium text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-calendar-picker-indicator]:hidden ${
            clearable ? 'pr-20' : 'pr-11'
          } ${inputClassName ?? ''}`.trim()}
        />

        {clearable && value.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            aria-label={t.common.clear}
            title={t.common.clear}
            className="absolute right-9 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        <button
          ref={anchorRef}
          type="button"
          onClick={handleTriggerClick}
          disabled={disabled}
          aria-label={`${label}: ${t.dashboard.selectDate}`}
          title={t.dashboard.selectDate}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={dialogId}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {isOpen && (
        <CalendarPopup
          id={dialogId}
          popupRef={popupRef}
          position={position}
          label={t.dashboard.specificDate}
          onKeyDown={handlePopupKeyDown}
        >
          <Calendar
            month={month}
            selectedValue={value}
            minValue={min}
            maxValue={max}
            onMonthChange={setMonth}
            onSelect={handleSelect}
            onClose={() => close(true)}
          />
        </CalendarPopup>
      )}
    </div>
  )
}
