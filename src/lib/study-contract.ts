import type { StudyAssociation, StudyDay } from './study-normalization'
export const STUDY_PERIODS = ['7d', '30d', '90d', '365d', 'all'] as const
export type StudyPeriod = typeof STUDY_PERIODS[number]
export interface StudyResponse {
  period: StudyPeriod
  days: readonly StudyDay[]
  excludedRecords: number
  records: { exercise: number; mood: number; insulin: number; food: number; kubios: number }
  sources: { health: 'ready'; kubios: 'ready' | 'partial' | 'unavailable' | 'restricted' }
  associations: { durationMood: StudyAssociation; intensityMood: StudyAssociation; durationRmssd: StudyAssociation }
}
