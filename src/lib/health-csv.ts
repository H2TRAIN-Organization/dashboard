import type {
  ExerciseData,
  FoodData,
  InsulinData,
  MoodData,
  PeriodRecord,
} from './api-types'

/**
 * Single CSV contract for every Health Data export (DR14/DR15).
 *
 * All five categories share one header and column order. Fields that mean
 * different things but used to collide (for example exercise `intensity` and
 * period `intensity`) get distinct column names. Values that do not apply to a
 * category are written as empty cells, never dropped or reordered.
 *
 * This module deliberately uses only functional health fields. Ciphertext
 * companions (`*_iv`), password material and internal identifiers never enter
 * the export.
 */
export const HEALTH_DATA_CATEGORIES = [
  'insulin',
  'food',
  'exercise',
  'period',
  'mood',
] as const

export type HealthDataCategory = (typeof HEALTH_DATA_CATEGORIES)[number]

export const HEALTH_CSV_COLUMNS = [
  'record_id',
  'username',
  'category',
  'recorded_at',
  'insulin_type',
  'insulin_dose',
  'insulin_actual_date_time',
  'food_type',
  'food_quantity',
  'food_carbs',
  'exercise_type',
  'exercise_intensity',
  'exercise_start_time',
  'exercise_end_time',
  'exercise_description',
  'period_start_date',
  'period_end_date',
  'period_intensity',
  'period_symptoms',
  'period_notes',
  'mood_value',
  'mood_out_of_routine',
  'mood_routine_description',
  'mood_emotions',
  'mood_other_emotion',
] as const

export type HealthCsvColumn = (typeof HEALTH_CSV_COLUMNS)[number]

export type HealthCsvRow = Record<HealthCsvColumn, string>

export interface HealthDataCollections {
  insulinData: readonly InsulinData[]
  foodData: readonly FoodData[]
  exerciseData: readonly ExerciseData[]
  periodData: readonly PeriodRecord[]
  moodData: readonly MoodData[]
}

export interface HealthCsvOptions {
  /**
   * Categories to include. Omitted means every category. The header and row
   * shape are identical for a single category and for the whole export.
   */
  categories?: readonly HealthDataCategory[]
  /**
   * Category values written to the `category` column. Defaults to the stable
   * machine-readable identifiers so the file is language independent.
   */
  categoryLabel?: (category: HealthDataCategory) => string
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CSV_UNSAFE_PATTERN = /[";\r\n]/
const LEADING_OR_TRAILING_SPACE = /^\s|\s$/

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (Array.isArray(value)) return value.map((entry) => cell(entry)).join('; ')
  return String(value)
}

/**
 * Exports keep date and time. ISO timestamps are normalized to UTC so the file
 * does not depend on the viewer timezone; date-only values stay untouched.
 * Values that cannot be parsed are preserved verbatim.
 */
export function formatHealthCsvDateTime(value: unknown): string {
  const raw = cell(value)
  if (raw === '') return ''
  if (DATE_ONLY_PATTERN.test(raw)) return raw
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toISOString()
}

function emptyRow(): HealthCsvRow {
  const row = {} as HealthCsvRow
  for (const column of HEALTH_CSV_COLUMNS) {
    row[column] = ''
  }
  return row
}

function set(row: HealthCsvRow, column: HealthCsvColumn, value: unknown): void {
  row[column] = cell(value)
}

function baseRow(
  category: HealthDataCategory,
  record: { id: string; username: string },
  recordedAt: unknown,
  options: HealthCsvOptions,
): HealthCsvRow {
  const row = emptyRow()
  set(row, 'record_id', record.id)
  set(row, 'username', record.username)
  set(
    row,
    'category',
    options.categoryLabel ? options.categoryLabel(category) : category,
  )
  set(row, 'recorded_at', formatHealthCsvDateTime(recordedAt))
  return row
}

function insulinRow(
  item: InsulinData,
  options: HealthCsvOptions,
): HealthCsvRow {
  const row = baseRow('insulin', item, item.date_time, options)
  set(row, 'insulin_type', item.insulinType)
  set(row, 'insulin_dose', item.dose)
  set(row, 'insulin_actual_date_time', formatHealthCsvDateTime(item.actualDateTime))
  return row
}

function foodRow(item: FoodData, options: HealthCsvOptions): HealthCsvRow {
  const row = baseRow('food', item, item.date_time, options)
  set(row, 'food_type', item.food_type)
  set(row, 'food_quantity', item.quantity)
  set(row, 'food_carbs', item.carbs)
  return row
}

function exerciseRow(
  item: ExerciseData,
  options: HealthCsvOptions,
): HealthCsvRow {
  const row = baseRow('exercise', item, item.date_time, options)
  set(row, 'exercise_type', item.exercise_type)
  set(row, 'exercise_intensity', item.intensity)
  set(row, 'exercise_start_time', formatHealthCsvDateTime(item.exercise_start_time))
  set(row, 'exercise_end_time', formatHealthCsvDateTime(item.exercise_end_time))
  set(row, 'exercise_description', item.exercise_description)
  return row
}

function periodRow(
  item: PeriodRecord,
  options: HealthCsvOptions,
): HealthCsvRow {
  const row = baseRow('period', item, item.date_time, options)
  set(row, 'period_start_date', formatHealthCsvDateTime(item.startDate))
  set(row, 'period_end_date', formatHealthCsvDateTime(item.endDate))
  set(row, 'period_intensity', item.intensity)
  set(row, 'period_symptoms', item.symptoms)
  set(row, 'period_notes', item.notes)
  return row
}

function moodRow(item: MoodData, options: HealthCsvOptions): HealthCsvRow {
  const row = baseRow('mood', item, item.date_time, options)
  set(row, 'mood_value', item.mood_value)
  set(row, 'mood_out_of_routine', item.out_of_routine)
  set(row, 'mood_routine_description', item.routine_description)
  set(row, 'mood_emotions', item.emotions)
  set(row, 'mood_other_emotion', item.other_emotion)
  return row
}

export function buildHealthCsvRows(
  data: HealthDataCollections,
  options: HealthCsvOptions = {},
): HealthCsvRow[] {
  const included = new Set<HealthDataCategory>(
    options.categories ?? HEALTH_DATA_CATEGORIES,
  )
  const rows: HealthCsvRow[] = []

  if (included.has('insulin')) {
    for (const item of data.insulinData) rows.push(insulinRow(item, options))
  }
  if (included.has('food')) {
    for (const item of data.foodData) rows.push(foodRow(item, options))
  }
  if (included.has('exercise')) {
    for (const item of data.exerciseData) rows.push(exerciseRow(item, options))
  }
  if (included.has('period')) {
    for (const item of data.periodData) rows.push(periodRow(item, options))
  }
  if (included.has('mood')) {
    for (const item of data.moodData) rows.push(moodRow(item, options))
  }

  return rows
}

export function escapeHealthCsvValue(value: string): string {
  if (value === '') return ''
  // Text from participants must remain text when a spreadsheet opens the
  // export. Keep genuine numeric values (including negative IDs) unchanged.
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
  if (/^[\s]*[=+@-]/.test(value) && !numeric.test(value.trim())) {
    value = `'${value}`
  }
  if (
    CSV_UNSAFE_PATTERN.test(value) ||
    LEADING_OR_TRAILING_SPACE.test(value) ||
    value.includes('"')
  ) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function serializeHealthCsv(rows: readonly HealthCsvRow[]): string {
  const lines: string[] = [HEALTH_CSV_COLUMNS.join(';')]
  for (const row of rows) {
    lines.push(
      HEALTH_CSV_COLUMNS.map((column) =>
        escapeHealthCsvValue(row[column] ?? ''),
      ).join(';'),
    )
  }
  return lines.join('\n')
}

/**
 * Full downloadable document. The BOM keeps accents readable in Excel while
 * the semicolon separator matches the existing Spanish-locale exports.
 */
export function buildHealthCsvDocument(
  data: HealthDataCollections,
  options: HealthCsvOptions = {},
): string {
  return `\uFEFF${serializeHealthCsv(buildHealthCsvRows(data, options))}`
}

export function healthCsvFilename(
  categories: readonly HealthDataCategory[] | undefined,
): string {
  if (categories === undefined || categories.length !== 1) {
    return 'datos_salud.csv'
  }
  return `datos_salud_${categories[0]}.csv`
}
