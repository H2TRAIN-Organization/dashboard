'use client'

import { useId, useRef, useState } from 'react'
import { Calendar as CalendarIcon } from 'lucide-react'
import { useOptionalLanguage } from '@/contexts/LanguageContext'
import Calendar from './Calendar'
import CalendarPopup from './CalendarPopup'
import { formatDisplayDateValue, parseDateValue } from './calendar-utils'
import { useCalendarPopover } from './useCalendarPopover'

export interface CalendarDatePickerProps {
  /** Optional id for the trigger button; useful to pair it with a label. */
  id?: string
  /** Controlled `YYYY-MM-DD` value. Empty string means no selection. */
  value: string
  onChange: (value: string) => void
  /**
   * Called when the user moves to another month. Health Data uses it to keep
   * filtering immediately, matching its previous previous/next behaviour.
   */
  onMonthChange?: (month: Date) => void
  placeholder: string
  /** Stable today value; defaults to the component mount date. */
  today?: Date
  disabled?: boolean
  className?: string
  buttonClassName?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

const DEFAULT_BUTTON_CLASSES =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:rounded-xl sm:px-4 sm:py-3 sm:text-base'

/**
 * Health Data style calendar trigger. It keeps the value as a controlled
 * `YYYY-MM-DD` string and exposes month navigation separately from selection,
 * so consumers can decide whether changing months also changes the filter.
 */
export default function CalendarDatePicker({
  id,
  value,
  onChange,
  onMonthChange,
  placeholder,
  today,
  disabled = false,
  className,
  buttonClassName,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: CalendarDatePickerProps) {
  const { language, t } = useOptionalLanguage()
  const [defaultToday] = useState(() => new Date())
  const todayDate = today ?? defaultToday
  const locale = language === 'en' ? 'en-US' : 'es-ES'
  const generatedId = useId()
  const triggerId = id ?? `calendar-date-trigger-${generatedId}`
  const dialogId = `${triggerId}-dialog`

  const [month, setMonth] = useState(
    () => parseDateValue(value) ?? todayDate,
  )
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const { isOpen, position, open, close, handlePopupKeyDown } =
    useCalendarPopover(anchorRef, popupRef)

  // The month is reset from the value whenever the trigger opens, so external
  // clears or selections never leave a stale page behind.

  const displayValue = formatDisplayDateValue(value, locale)

  const handleTriggerClick = () => {
    if (isOpen) {
      close(false)
      return
    }
    setMonth(parseDateValue(value) ?? todayDate)
    open()
  }

  const handleMonthChange = (nextMonth: Date) => {
    setMonth(nextMonth)
    onMonthChange?.(nextMonth)
  }

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    close(true)
  }

  return (
    <div className={className}>
      <button
        ref={anchorRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        onClick={handleTriggerClick}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={dialogId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={`${DEFAULT_BUTTON_CLASSES} ${buttonClassName ?? ''}`.trim()}
      >
        <span
          className={`truncate ${displayValue ? 'text-slate-900' : 'text-slate-500'}`}
        >
          {displayValue ?? placeholder}
        </span>
        <CalendarIcon
          className="h-4 w-4 shrink-0 text-blue-600 sm:h-5 sm:w-5"
          aria-hidden="true"
        />
      </button>

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
            today={todayDate}
            onMonthChange={handleMonthChange}
            onSelect={handleSelect}
            onClose={() => close(true)}
          />
        </CalendarPopup>
      )}
    </div>
  )
}
