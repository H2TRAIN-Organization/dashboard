'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ApiError, authApi, errorFrom } from '@/lib/api-client'
import type { ClientSession, LoginInput } from '@/lib/api-types'

interface SessionContextType {
  session: ClientSession | null
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
  login: (input: LoginInput) => Promise<ClientSession>
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionContextType | undefined>(undefined)

/**
 * Single source of truth for the verified backend session. Both AuthContext
 * (email method) and AppAuthContext (username method) derive their public state
 * from this provider. Session material lives in an HttpOnly cookie; this state
 * only keeps the public user returned by the backend.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ClientSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(true)
  const revisionRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    const handleUnauthorized = () => {
      revisionRef.current += 1
      setSession(null)
      setError(null)
      setLoading(false)
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => {
      mountedRef.current = false
      window.removeEventListener('auth:unauthorized', handleUnauthorized)
    }
  }, [])

  const refresh = useCallback(async () => {
    const revision = revisionRef.current
    setLoading(true)
    try {
      const next = await authApi.session()
      if (!mountedRef.current || revision !== revisionRef.current) return
      setSession(next)
      setError(null)
    } catch (caught) {
      if (!mountedRef.current || revision !== revisionRef.current) return
      setSession(null)
      if (caught instanceof ApiError && caught.status === 401) {
        // No session is a normal state, not an error.
        setError(null)
      } else {
        setError(errorFrom(caught))
      }
    } finally {
      if (mountedRef.current && revision === revisionRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (input: LoginInput) => {
    revisionRef.current += 1
    try {
      const next = await authApi.login(input)
      setSession(next)
      setError(null)
      return next
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    revisionRef.current += 1
    try {
      await authApi.logout()
    } catch {
      // The local state must be cleared even when the network fails; the next
      // session check will confirm whether the cookie was revoked.
    } finally {
      setSession(null)
      setError(null)
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const value = useMemo(
    () => ({ session, loading, error, refresh, login, logout }),
    [session, loading, error, refresh, login, logout],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = useContext(SessionContext)
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
