'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { canAccessShellPath } from '@/components/dashboard-shell/route-access'

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t.common.loading}</p>
        </div>
      </div>
    )
  }

  if (!session || !allowed) {
    return null
  }

  return <>{children}</>
}
