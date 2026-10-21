import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Legacy browser client. Access is being migrated to same-origin API routes
// with HttpOnly cookies; do not add fallback URLs or keys here.
let browserClient: SupabaseClient | null = null

function getBrowserClient(): SupabaseClient {
  if (browserClient !== null) {
    return browserClient
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase browser client no configurado: faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    )
  }

  browserClient = createClient(supabaseUrl, supabaseAnonKey)
  return browserClient
}

/**
 * Fail-closed lazy proxy so importing legacy pages during build does not require
 * production credentials. Any actual Supabase call throws until the frontend is
 * migrated to the cookie-based API.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getBrowserClient()
    const value = Reflect.get(client, property)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export interface User {
  UserID: number
  Username: string
  UUID: string | null
  GDPRConsent: boolean
  GDPRConsentDate: string | null
  sexo: string | null
  bomba_insulina: boolean
  role: 'admin' | 'doctor' | 'user'
}

// Interfaces para los datos reales de la aplicación
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

// Tipos de roles disponibles
export type UserRole = 'admin' | 'doctor' | 'user'

// Permisos por rol
export const ROLE_PERMISSIONS = {
  admin: [
    'view_dashboard',
    'view_users',
    'manage_users',
    'view_data',
    'export_data',
    'view_analytics',
    'view_kubios',
    'view_study',
    'view_admin',
    'manage_database',
    'manage_settings',
    'view_all_data'
  ],
  doctor: [
    'view_dashboard',
    'view_users',
    'view_data',
    'export_data',
    'view_analytics',
    'view_kubios',
    'view_study',
    'view_patient_data'
  ],
  user: [
    'view_dashboard',
    'view_own_data',
    'view_own_analytics'
  ]
} as const
