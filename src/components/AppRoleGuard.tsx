'use client'

import { useAppAuth } from '@/contexts/AppAuthContext'
import { ReactNode } from 'react'
import type { UserRole } from '@/lib/api-types'
import { hasPermission, hasRoleAtLeast } from '@/lib/permissions'

interface AppRoleGuardProps {
  children: ReactNode
  requiredRole?: UserRole
  requiredPermission?: string
  fallback?: ReactNode
}

export default function AppRoleGuard({
  children,
  requiredRole,
  requiredPermission,
  fallback = null,
}: AppRoleGuardProps) {
  const { userRole } = useAppAuth()

  if (!requiredRole && !requiredPermission) {
    return <>{children}</>
  }

  if (!userRole) {
    return <>{fallback}</>
  }

  if (requiredRole && !hasRoleAtLeast(userRole, requiredRole)) {
    return <>{fallback}</>
  }

  if (requiredPermission && !hasPermission(userRole, requiredPermission)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
