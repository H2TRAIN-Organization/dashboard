'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { canAccessShellPath } from '@/components/dashboard-shell/route-access'
import { LoadingState } from '@/components/ui/loading-state'

interface HybridProtectedRouteProps {
  children: React.ReactNode
}

/**
 * Protección compartida por ambas credenciales. La sesión HttpOnly es la
 * única autoridad; además de exigir sesión, aplica la política central de
 * rutas para que un acceso directo no muestre vistas de otro rol.
 */
export default function HybridProtectedRoute({ children }: HybridProtectedRouteProps) {
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
      router.replace('/')
    }
  }, [allowed, loading, router, session])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50">
        <LoadingState label={t.auth.verifyingSession} className="w-full max-w-sm" />
      </div>
    )
  }

  if (!session || !allowed) {
    return null
  }

  return <>{children}</>
}
