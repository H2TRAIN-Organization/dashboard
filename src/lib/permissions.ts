import type { UserRole } from './api-types'

/**
 * UI capabilities. The backend remains the authority; these permissions only
 * decide which controls and links are rendered.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly string[]> = {
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
    'view_all_data',
  ],
  doctor: [
    'view_dashboard',
    'view_users',
    'view_data',
    'export_data',
    'view_analytics',
    'view_kubios',
    'view_study',
    'view_patient_data',
  ],
  user: [
    'view_dashboard',
    'view_data',
    'view_own_data',
    'view_analytics',
    'view_own_analytics',
  ],
}

const ROLE_WEIGHT: Record<UserRole, number> = {
  user: 1,
  doctor: 2,
  admin: 3,
}

export function hasRoleAtLeast(role: UserRole, required: UserRole): boolean {
  return ROLE_WEIGHT[role] >= ROLE_WEIGHT[required]
}

export function hasPermission(role: UserRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}
