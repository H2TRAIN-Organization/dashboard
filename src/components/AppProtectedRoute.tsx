'use client'

import { useAppAuth } from '@/contexts/AppAuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { LoadingState } from '@/components/ui/loading-state'

interface AppProtectedRouteProps {
  children: React.ReactNode
}

export default function AppProtectedRoute({ children }: AppProtectedRouteProps) {
  const { user, loading } = useAppAuth()
  const { t } = useLanguage()
  const router = useRouter()

  useEffect(() => {
    // Si no hay carga en curso y no hay usuario autenticado
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  // Mostrar loading mientras se verifica la autenticación
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50">
        <LoadingState label={t.auth.verifyingSession} className="w-full max-w-sm" />
      </div>
    )
  }

  // Si no hay usuario autenticado, no renderizar nada (el useEffect se encargará del redirect)
  if (!user) {
    return null
  }

  return <>{children}</>
}

