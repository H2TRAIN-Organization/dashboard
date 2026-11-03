'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { canAccessShellPath } from '@/components/dashboard-shell/route-access'

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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">{t.auth.verifyingSession}</p>
        </div>
      </div>
    )
  }

  if (!session || !allowed) {
    return null
  }

  return <>{children}</>
}
