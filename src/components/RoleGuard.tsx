'use client'

import { ReactNode } from 'react'
import { useSession } from '@/contexts/SessionContext'
import type { UserRole } from '@/lib/api-types'
import { ROLE_PERMISSIONS, hasPermission, hasRoleAtLeast } from '@/lib/permissions'
import { Shield, AlertCircle } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface RoleGuardProps {
  children: ReactNode
  requiredRole?: UserRole
  requiredPermission?: string
  fallback?: ReactNode
  showError?: boolean
}

export function RoleDenied({
  requiredRole,
  requiredPermission,
  currentRole,
}: {
  requiredRole?: UserRole
  requiredPermission?: string
  currentRole: UserRole
}) {
  const { t } = useLanguage()
  const roleLabel = t.roles[requiredRole === 'admin' ? 'administrator' : requiredRole === 'doctor' ? 'physician' : 'patient']

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Shield className="h-16 w-16 text-orange-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.auth.insufficientPermissions}</h2>
        <p className="text-gray-600 mb-4">
          {requiredRole
            ? t.auth.needRole.replace('{role}', roleLabel)
            : t.auth.noPermission}
        </p>
        <p className="text-sm text-gray-500">
          {t.auth.currentRole}:{' '}
          <span className="font-semibold">
            {currentRole === 'admin'
              ? t.roles.administrator
              : currentRole === 'doctor'
                ? t.roles.physician
                : t.roles.patient}
          </span>
          {requiredPermission ? ` · ${t.auth.requiredPermission}: ${requiredPermission}` : ''}
        </p>
      </div>
    </div>
  )
}

export default function RoleGuard({
  children,
  requiredRole,
  requiredPermission,
  fallback,
  showError = true,
}: RoleGuardProps) {
  const { session, loading } = useSession()
  const { t } = useLanguage()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!session) {
    return showError ? (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.auth.accessDenied}</h2>
          <p className="text-gray-600">{t.auth.loginRequired}</p>
        </div>
      </div>
    ) : fallback ?? null
  }

  const currentUserRole = session.user.role

  if (requiredRole && !hasRoleAtLeast(currentUserRole, requiredRole)) {
    return showError ? (
      <RoleDenied
        requiredRole={requiredRole}
        requiredPermission={requiredPermission}
        currentRole={currentUserRole}
      />
    ) : fallback ?? null
  }

  if (requiredPermission && !hasPermission(currentUserRole, requiredPermission)) {
    return showError ? (
      <RoleDenied
        requiredRole={requiredRole}
        requiredPermission={requiredPermission}
        currentRole={currentUserRole}
      />
    ) : fallback ?? null
  }

  return <>{children}</>
}

export function usePermissions() {
  const { session } = useSession()
  const currentUserRole: UserRole = session?.user.role ?? 'user'
  const permissions = ROLE_PERMISSIONS[currentUserRole]

  const hasPermissionForRole = (permission: string) =>
    permissions.includes(permission)

  const hasRole = (role: UserRole) => hasRoleAtLeast(currentUserRole, role)

  const canAccess = (requiredRole?: UserRole, requiredPermission?: string) => {
    if (requiredRole && !hasRole(requiredRole)) return false
    if (requiredPermission && !hasPermissionForRole(requiredPermission)) return false
    return true
  }

  return {
    userRole: currentUserRole,
    permissions,
    hasPermission: hasPermissionForRole,
    hasRole,
    canAccess,
  }
}
