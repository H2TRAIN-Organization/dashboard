'use client'

/**
 * Compact pill rendering for Health Data records (MT34).
 *
 * The previous cards consumed a large amount of vertical space for the two or
 * three fields each record carries. A pill keeps the same type accent colors
 * and the same type icon as the rest of the dashboard while fitting several
 * records per row.
 */

import type {
  ExerciseData,
  FoodData,
  InsulinData,
  MoodData,
  PeriodRecord,
} from '@/lib/api-types'
import {
  Dumbbell,
  Pill,
  Smile,
  Utensils,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react'
import { useOptionalLanguage } from '@/contexts/LanguageContext'

export type HealthRecordType =
  | 'insulin'
  | 'food'
  | 'exercise'
  | 'period'
  | 'mood'

export type HealthRecord =
  | InsulinData
  | FoodData
  | ExerciseData
  | PeriodRecord
  | MoodData

interface RecordTypeMeta {
  Icon: LucideIcon
  /** Gradient used by the type badge inside the pill. */
  iconClass: string
  /** Border color of the pill itself. */
  borderClass: string
  /** Type name in the active language. */
  labelKey: 'insulin' | 'meals' | 'exercise' | 'periods' | 'mood'
}

const RECORD_TYPE_META: Record<HealthRecordType, RecordTypeMeta> = {
  insulin: {
    Icon: Pill,
    iconClass: 'from-blue-500 to-blue-600',
    borderClass: 'border-blue-200',
    labelKey: 'insulin',
  },
  food: {
    Icon: Utensils,
    iconClass: 'from-green-500 to-green-600',
    borderClass: 'border-green-200',
    labelKey: 'meals',
  },
  exercise: {
    Icon: Dumbbell,
    iconClass: 'from-orange-500 to-orange-600',
    borderClass: 'border-orange-200',
    labelKey: 'exercise',
  },
  period: {
    Icon: CalendarDays,
    iconClass: 'from-purple-500 to-purple-600',
    borderClass: 'border-purple-200',
    labelKey: 'periods',
  },
  mood: {
    Icon: Smile,
    iconClass: 'from-pink-500 to-pink-600',
    borderClass: 'border-pink-200',
    labelKey: 'mood',
  },
}

/** One "label: value" chunk inside a pill. */
interface PillDetail {
  label: string
  value: string
}

type DashboardTranslations = ReturnType<typeof useOptionalLanguage>['t']

/**
 * The specific information each data type must show: dose and insulin type
 * for injections, food type/quantity/carbs for meals, and so on.
 */
function recordDetails(
  record: HealthRecord,
  type: HealthRecordType,
  t: DashboardTranslations,
): PillDetail[] {
  const dashboard = t.dashboard
  switch (type) {
    case 'insulin': {
      if (!('insulinType' in record)) return []
      return [
        { label: dashboard.dose, value: String(record.dose ?? '') },
        { label: dashboard.type, value: String(record.insulinType ?? '') },
      ]
    }
    case 'food': {
      if (!('food_type' in record)) return []
      return [
        { label: dashboard.type, value: String(record.food_type ?? '') },
        { label: dashboard.quantity, value: String(record.quantity ?? '') },
        { label: dashboard.carbs, value: String(record.carbs ?? '') },
      ]
    }
    case 'exercise': {
      if (!('exercise_type' in record)) return []
      return [
        { label: dashboard.type, value: String(record.exercise_type ?? '') },
        { label: dashboard.intensity, value: String(record.intensity ?? '') },
        {
          label: dashboard.description,
          value: String(record.exercise_description ?? ''),
        },
      ]
    }
    case 'period': {
      if (!('symptoms' in record)) return []
      return [
        { label: dashboard.intensity, value: String(record.intensity ?? '') },
        {
          label: dashboard.symptoms,
          value: Array.isArray(record.symptoms)
            ? record.symptoms.join(', ')
            : String(record.symptoms ?? ''),
        },
      ]
    }
    case 'mood': {
      if (!('emotions' in record)) return []
      return [
        { label: dashboard.value, value: `${String(record.mood_value ?? '')}/10` },
        {
          label: dashboard.emotions,
          value: Array.isArray(record.emotions)
            ? record.emotions.join(', ')
            : String(record.emotions ?? ''),
        },
      ]
    }
  }
}

function recordDate(record: HealthRecord): string {
  const raw = record.date_time ?? ('startDate' in record ? record.startDate : '')
  return String(raw ?? '')
}

export function RecordPill({
  record,
  type,
  locale,
  t,
}: {
  record: HealthRecord
  type: HealthRecordType
  locale: string
  t: DashboardTranslations
}) {
  const meta = RECORD_TYPE_META[type]
  const { Icon } = meta
  const dateText = new Date(recordDate(record)).toLocaleDateString(locale)
  const details = recordDetails(record, type, t)

  return (
    <div
      className={`inline-flex max-w-full items-center gap-2.5 rounded-full border ${meta.borderClass} bg-white/85 py-1.5 pl-1.5 pr-3.5 shadow-sm backdrop-blur-sm`}
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r ${meta.iconClass} px-2.5 py-1 text-[11px] font-semibold text-white sm:text-xs`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {t.dashboard[meta.labelKey]}
      </span>
      <span className="shrink-0 text-[11px] font-medium text-gray-500 sm:text-xs">
        {dateText}
      </span>
      {details.length > 0 && (
        <span className="hidden h-4 w-px shrink-0 bg-gray-200 sm:block" aria-hidden="true" />
      )}
      <span className="min-w-0 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-700 sm:text-xs">
        {details.map((detail) => (
          <span key={detail.label} className="min-w-0 whitespace-nowrap">
            <span className="font-semibold text-gray-900">{detail.label}:</span>{' '}
            {detail.value}
          </span>
        ))}
      </span>
    </div>
  )
}

/** Wrapping list of record pills for one data type and page. */
export function RecordPillList({
  records,
  type,
  locale,
  t,
}: {
  records: readonly HealthRecord[]
  type: HealthRecordType
  locale: string
  t: DashboardTranslations
}) {
  return (
    <div className="flex flex-wrap items-start gap-2.5">
      {records.map((record) => (
        <RecordPill
          key={record.id}
          record={record}
          type={type}
          locale={locale}
          t={t}
        />
      ))}
    </div>
  )
}

export { RECORD_TYPE_META }
