import type { KubiosCsvRow } from './kubios-csv'

export interface AdminKubiosMeasurement extends KubiosCsvRow {
  measured_timestamp: string | null
}
export interface AdminKubiosParticipant {
  username: string
  userId: number
  status: 'pending' | 'empty' | 'ready' | 'stale'
  syncedAt: string | null
  measurementCount: number
  results: readonly AdminKubiosMeasurement[]
}
export interface AdminKubiosPage {
  participants: readonly Omit<AdminKubiosParticipant, 'results'>[]
  page: number
  pageSize: number
  total: number
}
