'use client'

import { createContext, useContext } from 'react'
import { errorFrom } from '@/lib/api-client'
import type { ClientSession, SessionUser, UserRole } from '@/lib/api-types'
import { useSession } from './SessionContext'

interface AuthContextType {
  /** Only populated when the verified backend session used the email method. */
  user: SessionUser | null
  session: ClientSession | null
  loading: boolean
  userRole: UserRole | null
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { session, loading, login, logout } = useSession()
  const emailSession = session?.method === 'email' ? session : null
  const user = emailSession?.user ?? null
  const userRole = user?.role ?? null

  const signIn = async (email: string, password: string) => {
    try {
      const next = await login({ email, password })
      if (next.method !== 'email') {
        await logout()
        return { error: new Error('La sesión no corresponde al acceso por email') }
      }
      return { error: null }
    } catch (caught) {
      return { error: errorFrom(caught) }
    }
  }

  const signUp = async (_email: string, _password: string) => {
    return {
      error: new Error(
        'El registro público no está disponible. Contacta con un administrador para crear la cuenta.',
      ),
    }
  }

  const signOut = async () => {
    await logout()
  }

  const value = {
    user,
    session: emailSession,
    loading,
    userRole,
    signIn,
    signUp,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
