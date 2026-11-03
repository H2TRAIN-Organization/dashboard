'use client'

import { useAppAuth } from '@/contexts/AppAuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">{t.auth.verifyingSession}</p>
        </div>
      </div>
    )
  }

  // Si no hay usuario autenticado, no renderizar nada (el useEffect se encargará del redirect)
  if (!user) {
    return null
  }

  return <>{children}</>
}

