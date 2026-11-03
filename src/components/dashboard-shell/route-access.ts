import type { UserRole } from '@/lib/api-types'
import { hasPermission } from '@/lib/permissions'

export interface ShellRouteAccessRule {
  /** Prefix matched against the normalized pathname. */
  prefix: string
  /** Any of these roles can enter the route. */
  roles?: readonly UserRole[]
  /** The role must hold this UI permission. */
  permission?: string
}

/**
 * Rutas con acceso restringido. El backend sigue siendo la autoridad; esta
 * política evita que una ruta directa muestre datos o controles que el rol no
 * puede usar y centraliza el comportamiento de las vistas ya existentes.
 */
export const SHELL_ROUTE_ACCESS_RULES: readonly ShellRouteAccessRule[] = [
  { prefix: '/admin', permission: 'view_admin' },
  { prefix: '/users', permission: 'view_users' },
  { prefix: '/overview', roles: ['admin', 'doctor'] },
  { prefix: '/study', permission: 'view_study' },
  { prefix: '/kubios', permission: 'view_own_kubios' },
  { prefix: '/data', permission: 'view_data' },
  { prefix: '/analytics', permission: 'view_analytics' },
]

export function normalizeShellPath(pathname: string): string {
  const withoutQuery = pathname.split('?')[0]?.split('#')[0] ?? '/'
  if (withoutQuery.length === 0) return '/'
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.replace(/\/+$/, '') || '/'
  }
  return withoutQuery
}

export function matchesShellPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function findShellRouteAccessRule(
  pathname: string,
): ShellRouteAccessRule | null {
  const normalized = normalizeShellPath(pathname)
  return (
    SHELL_ROUTE_ACCESS_RULES.find((rule) =>
      matchesShellPrefix(normalized, rule.prefix),
    ) ?? null
  )
}

export function canAccessShellPath(role: UserRole, pathname: string): boolean {
  const rule = findShellRouteAccessRule(pathname)
  if (rule === null) return true
  if (rule.roles !== undefined && !rule.roles.includes(role)) return false
  if (rule.permission !== undefined && !hasPermission(role, rule.permission)) {
    return false
  }
  return true
}
