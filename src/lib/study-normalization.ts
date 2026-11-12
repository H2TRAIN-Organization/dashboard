export type StudyRecord = Readonly<Record<string, unknown>>
export interface StudyDay {
  person: string
  day: string
  exerciseDuration: number | null
  intensity: number | null
  moodValue: number | null
  rmssd: number | null
  readiness: number | null
}
export interface StudyAssociation { coefficient: number | null; sampleSize: number; participants: number }

/** Naive legacy database timestamps are interpreted explicitly as UTC. */
export function utcTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)) return null
  const datePart = value.slice(0, 10)
  const calendarDay = new Date(datePart + 'T00:00:00Z')
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== datePart) return null
  const normalized = value.length > 10 && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value.replace(' ', 'T') + 'Z' : value
  const time = Date.parse(normalized)
  return Number.isFinite(time) ? time : null
}
export function studyNumber(value: unknown): number | null {
  if (typeof value === 'string' && !value.trim()) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
export function normalizeIntensity(value: unknown): number | null {
  const numeric = studyNumber(value)
  if (numeric !== null) return numeric >= 1 && numeric <= 3 ? numeric : null
  const labels: Record<string, number> = { bajo: 1, baja: 1, low: 1, moderado: 2, moderada: 2, medio: 2, media: 2, medium: 2, moderate: 2, alto: 3, alta: 3, high: 3 }
  return typeof value === 'string' ? labels[value.trim().toLowerCase()] ?? null : null
}
export function exerciseMinutes(record: StudyRecord): number | null {
  const direct = studyNumber(record.duration)
  if (direct !== null && direct >= 0) return direct
  const start = utcTimestamp(record.exercise_start_time)
  const end = utcTimestamp(record.exercise_end_time)
  return start !== null && end !== null && end >= start ? (end - start) / 60000 : null
}
function personOf(record: StudyRecord): string | null {
  // Health rows use literal username; Kubios rows are joined to the verified username server-side.
  return typeof record.username === 'string' && record.username.length > 0 ? record.username : null
}
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
export function normalizeStudyDays(exercise: readonly StudyRecord[], mood: readonly StudyRecord[], kubios: readonly StudyRecord[] = []): { days: StudyDay[]; excludedRecords: number } {
  const groups = new Map<string, { person: string; day: string; durations: number[]; intensity: number[]; mood: number[]; rmssd: number[]; readiness: number[] }>()
  let excludedRecords = 0
  function bucket(record: StudyRecord) {
    const person = personOf(record)
    const time = utcTimestamp(record.date_time ?? record.date ?? record.measured_timestamp ?? record.exercise_start_time)
    if (!person || time === null) { excludedRecords++; return null }
    const day = new Date(time).toISOString().slice(0, 10)
    const key = JSON.stringify([person, day])
    if (!groups.has(key)) groups.set(key, { person, day, durations: [], intensity: [], mood: [], rmssd: [], readiness: [] })
    return groups.get(key)!
  }
  for (const record of exercise) {
    const group = bucket(record); if (!group) continue
    const duration = exerciseMinutes(record); const intensity = normalizeIntensity(record.intensity)
    if (duration !== null) group.durations.push(duration)
    if (intensity !== null) group.intensity.push(intensity)
  }
  for (const record of mood) {
    const group = bucket(record); const value = studyNumber(record.mood_value)
    if (group && value !== null) group.mood.push(value)
  }
  for (const record of kubios) {
    const group = bucket(record); if (!group) continue
    const result = record.result && typeof record.result === 'object' ? record.result as StudyRecord : {}
    const rmssd = studyNumber(result.rmssd_ms); const readiness = studyNumber(result.readiness)
    if (rmssd !== null) group.rmssd.push(rmssd)
    if (readiness !== null) group.readiness.push(readiness)
  }
  return { excludedRecords, days: [...groups.values()].map(g => ({ person: g.person, day: g.day,
    exerciseDuration: g.durations.length ? g.durations.reduce((a,b) => a+b,0) : null,
    intensity: mean(g.intensity), moodValue: mean(g.mood), rmssd: mean(g.rmssd), readiness: mean(g.readiness),
  })).sort((a,b) => a.day.localeCompare(b.day) || a.person.localeCompare(b.person)) }
}
export function studyAssociation(days: readonly StudyDay[], first: keyof Pick<StudyDay, 'exerciseDuration'|'intensity'|'moodValue'|'rmssd'|'readiness'>, second: typeof first): StudyAssociation {
  const pairs = days.filter(d => d[first] !== null && d[second] !== null)
  const participants = new Set(pairs.map(d => d.person)).size
  const sampleSize = pairs.length
  if (sampleSize < 3) return { coefficient: null, sampleSize, participants }
  const x = pairs.map(d => d[first]!); const y = pairs.map(d => d[second]!)
  const mx = mean(x)!; const my = mean(y)!
  let covariance = 0; let vx = 0; let vy = 0
  for (let i=0;i<x.length;i++) { const dx = x[i]! - mx; const dy = y[i]! - my; covariance += dx*dy; vx += dx**2; vy += dy**2 }
  const coefficient = vx > 0 && vy > 0 ? Math.max(-1,Math.min(1,covariance / Math.sqrt(vx*vy))) : null
  return { coefficient, sampleSize, participants }
}
