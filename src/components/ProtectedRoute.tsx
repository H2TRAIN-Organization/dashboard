'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { canAccessShellPath } from '@/components/dashboard-shell/route-access'
import { LoadingState } from '@/components/ui/loading-state'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { session, loading } = useSession()
  const { t } = useLanguage()
  const pathname = usePathname()
  const router = useRouter()

  const allowed =
    session !== null && canAccessShellPath(session.user.role, pathname)

  useEffect(() => {
    if (loading) return
    if (!session) {
      router.replace('/login')
      return
    }
    if (!allowed) {
      // Una ruta directa no permitida vuelve al inicio común, donde solo se
      // muestran las opciones del rol real.
      router.replace('/')
    }
  }, [allowed, loading, router, session])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <LoadingState label={t.common.loading} className="w-full max-w-sm" />
      </div>
    )
  }

  if (!session || !allowed) {
    return null
  }

  return <>{children}</>
}
