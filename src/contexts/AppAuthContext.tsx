'use client'

import { createContext, useContext } from 'react'
import { errorFrom } from '@/lib/api-client'
import type { AppUser, AuthMethod, UserRole } from '@/lib/api-types'
import { toAppUser } from '@/lib/user-mapper'
import { useSession } from './SessionContext'

interface AppAuthContextType {
  /** Only populated when the verified backend session used the username method. */
  user: AppUser | null
  loading: boolean
  signIn: (username: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  userRole: UserRole | null
  method: AuthMethod | null
}

const AppAuthContext = createContext<AppAuthContextType | undefined>(undefined)

export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  const { session, loading, login, logout } = useSession()
  const usernameSession = session?.method === 'username' ? session : null
  const user = usernameSession ? toAppUser(usernameSession.user) : null
  const userRole = user?.role ?? null

  const signIn = async (username: string, password: string) => {
    try {
      const next = await login({ username, password })
      if (next.method !== 'username') {
        await logout()
        return { error: new Error('La sesión no corresponde al acceso por usuario') }
      }
      return { error: null }
    } catch (caught) {
      return { error: errorFrom(caught) }
    }
  }

  const signOut = async () => {
    await logout()
  }

  const method: AuthMethod | null = usernameSession ? 'username' : null

  const value = {
    user,
    loading,
    signIn,
    signOut,
    userRole,
    method,
  }

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

export function useAppAuth() {
  const context = useContext(AppAuthContext)
  if (context === undefined) {
    throw new Error('useAppAuth must be used within an AppAuthProvider')
  }
  return context
}
