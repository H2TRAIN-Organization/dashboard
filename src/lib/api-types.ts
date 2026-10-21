export type UserRole = 'admin' | 'doctor' | 'user'

export type AuthMethod = 'email' | 'username'

/**
 * Canonical public user returned by the backend. It never contains password
 * hashes, verifiers or encrypted material.
 */
export interface SessionUser {
  id: string
  username: string
  email: string | null
  role: UserRole
  uuid: string | null
  gdprConsent: boolean
  gdprConsentAt: string | null
  createdAt: string | null
}

/**
 * Compatibility shape used by the existing dashboard screens. It is derived
 * from the canonical DTO by `toDashboardUser`; `PasswordHash` is intentionally
 * absent.
 */
export interface User {
  UserID: string
  Username: string
  Email: string | null
  UUID: string | null
  GDPRConsent: boolean
  GDPRConsentDate: string | null
  role: UserRole
  createdAt: string | null
}

/** Compatibility shape used by the username-based application area. */
export interface AppUser {
  UserID: string
  Username: string
  Email: string | null
  UUID: string | null
  GDPRConsent: boolean
  GDPRConsentDate: string | null
  role: UserRole
}

export interface ClientSession {
  user: SessionUser
  method: AuthMethod
  expiresAt: string
}

export type LoginInput =
  | { email: string; password: string }
  | { username: string; password: string }

export interface UserListResponse {
  users: SessionUser[]
  total: number
}

export interface UserResponse {
  user: SessionUser
}

export interface CountResponse {
  count: number
}

export interface UserCreateInput {
  username: string
  password: string
  email?: null
  role?: UserRole
  gdprConsent?: boolean
}

export interface UserUpdateInput {
  username?: string
  email?: null
  role?: UserRole
  gdprConsent?: boolean
}

export interface UserListQuery {
  search?: string
  role?: UserRole
  limit?: number
  offset?: number
}

export interface InsulinData {
  id: string
  username: string
  insulinType: string
  dose: string
  date_time: string
  actualDateTime: string
  insulintype_iv?: string
  dose_iv?: string
}

export interface FoodData {
  id: string
  username: string
  food_type: string
  quantity: string
  carbs: string
  date_time: string
  food_type_iv?: string
  quantity_iv?: string
  carbs_iv?: string
}

export interface ExerciseData {
  id: string
  username: string
  exercise_type: string
  intensity: string
  exercise_start_time: string
  exercise_end_time: string
  exercise_description: string
  date_time: string
  exercise_type_iv?: string
  exercise_description_iv?: string
}

export interface PeriodRecord {
  id: string
  username: string
  startDate: string
  endDate: string
  intensity: string
  symptoms: string[]
  notes: string
  date_time: string
  intensity_iv?: string
  symptoms_iv?: string[]
  notes_iv?: string
}

export interface MoodData {
  id: string
  username: string
  mood_value: number
  out_of_routine: boolean
  routine_description: string
  emotions: string[]
  other_emotion: string
  date_time: string
  routine_description_iv?: string
  emotions_iv?: string[]
  other_emotion_iv?: string
}

export interface DecryptedDataResponse {
  insulinData: InsulinData[]
  foodData: FoodData[]
  exerciseData: ExerciseData[]
  periodData: PeriodRecord[]
  moodData: MoodData[]
}

export interface DecryptedDataQuery {
  selectedUser?: string
  timeRange?: '7d' | '30d' | '90d' | 'all'
  selectedDataType?: 'all' | 'insulin' | 'food' | 'exercise' | 'period' | 'mood'
  dateFilter?: string
}

export interface AdminTableInfo {
  name: string
  recordCount: number
  accessible: boolean
  error?: string
}

export interface AdminTablesResponse {
  success: true
  tables: AdminTableInfo[]
  totalRecords: number
  accessibleCount: number
  totalCount: number
}

export interface AdminTableDataResponse {
  success: true
  tableName: string
  data: Record<string, unknown>[]
  totalRecords: number
  returnedRecords: number
  limit: number
}

export interface ProblemBody {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}
