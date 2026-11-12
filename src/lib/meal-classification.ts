/**
 * Food record classification for the Advanced Analytics charts (MT38, T14).
 *
 * The mobile uploader writes non-meal entries into the food table: glucose
 * events (hypoglycemia/hyperglycemia treatments) and insulin shots typed as
 * `food_type` (e.g. "Rápida", "Lenta", "Insulina rápida"). They are not
 * meals, so the "registered meal types" chart and the meal statistics must
 * exclude them instead of presenting them as meal types.
 */

export type FoodRecordKind = 'meal' | 'glucoseEvent' | 'insulinRecord' | 'untyped'

/** Glucose-event labels observed in the food table, lowercase, accentless. */
const GLUCOSE_EVENT_LABELS = new Set([
  'hipoglucemia',
  'hypoglucemia',
  'hiperglucemia',
  'hypoglycemia',
  'hyperglycemia',
])

/**
 * Insulin labels written into the food table, lowercase, accentless. Exact
 * matches only: a prefix match would swallow real meal types such as
 * "Comida rápida" (fast food).
 */
const INSULIN_RECORD_LABELS = new Set([
  'rapida',
  'lenta',
  'basal',
  'bolus',
  'nph',
])

function normalizeLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** A food record is a glucose event when its type names a glucose episode. */
export function classifyFoodRecord(foodType: unknown): FoodRecordKind {
  const normalized = normalizeLabel(foodType)
  if (GLUCOSE_EVENT_LABELS.has(normalized)) return 'glucoseEvent'
  if (normalized === 'insulina' || normalized.startsWith('insulina ')) return 'insulinRecord'
  if (INSULIN_RECORD_LABELS.has(normalized)) return 'insulinRecord'
  if (normalized.length === 0) return 'untyped'
  return 'meal'
}

interface FoodTypedRecord {
  readonly food_type?: unknown
}

export interface SplitFoodRecords<T> {
  /** Real meals: everything that is not a glucose event or an insulin shot. */
  readonly meals: T[]
  /** Glucose episodes stored in the food table. */
  readonly glucoseEvents: T[]
  /** Insulin shots stored in the food table (T14). */
  readonly insulinRecords: T[]
}

/**
 * Splits food records into meals and the non-meal entries written by the
 * mobile app. Untyped records stay in the meals group (they are food logs
 * without a type, shown as "no data").
 */
export function splitFoodRecords<T extends FoodTypedRecord>(
  records: readonly T[],
): SplitFoodRecords<T> {
  const meals: T[] = []
  const glucoseEvents: T[] = []
  const insulinRecords: T[] = []

  for (const record of records) {
    const kind = classifyFoodRecord(record.food_type)
    if (kind === 'glucoseEvent') glucoseEvents.push(record)
    else if (kind === 'insulinRecord') insulinRecords.push(record)
    else meals.push(record)
  }

  return { meals, glucoseEvents, insulinRecords }
}
