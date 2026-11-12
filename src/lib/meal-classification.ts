/**
 * Food record classification for the Advanced Analytics charts (MT38).
 *
 * The mobile uploader writes glucose events (hypoglycemia/hyperglycemia
 * treatments) into the food table. They are not meals, so the "registered
 * meal types" chart and the meal statistics must exclude them instead of
 * showing "Hipoglucemia" as a meal type.
 */

export type FoodRecordKind = 'meal' | 'glucoseEvent' | 'untyped'

/** Glucose-event labels observed in the food table, lowercase, accentless. */
const GLUCOSE_EVENT_LABELS = new Set([
  'hipoglucemia',
  'hypoglucemia',
  'hiperglucemia',
  'hypoglycemia',
  'hyperglycemia',
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
  if (normalized.length === 0) return 'untyped'
  return 'meal'
}

interface FoodTypedRecord {
  readonly food_type?: unknown
}

export interface SplitFoodRecords<T> {
  /** Real meals: everything that is not a glucose event. */
  readonly meals: T[]
  /** Glucose episodes stored in the food table. */
  readonly glucoseEvents: T[]
}

/**
 * Splits food records into meals and glucose events. Untyped records stay in
 * the meals group (they are food logs without a type, shown as "no data").
 */
export function splitFoodRecords<T extends FoodTypedRecord>(
  records: readonly T[],
): SplitFoodRecords<T> {
  const meals: T[] = []
  const glucoseEvents: T[] = []

  for (const record of records) {
    if (classifyFoodRecord(record.food_type) === 'glucoseEvent') {
      glucoseEvents.push(record)
    } else {
      meals.push(record)
    }
  }

  return { meals, glucoseEvents }
}
