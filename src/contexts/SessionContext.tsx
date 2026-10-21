'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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

interface SessionState {
  session: ClientSession | null
  loading: boolean
  error: Error | null
}

interface SessionStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SessionState
  set: (patch: Partial<SessionState>) => void
}

const SessionContext = createContext<SessionContextType | undefined>(undefined)

function createSessionStore(): SessionStore {
  let state: SessionState = { session: null, loading: true, error: null }
  const listeners = new Set<() => void>()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return state
    },
    set(patch) {
      state = { ...state, ...patch }
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

/**
 * Single source of truth for the verified backend session. Both AuthContext
 * (email method) and AppAuthContext (username method) derive their public state
 * from this provider. Session material lives in an HttpOnly cookie; this state
 * only keeps the public user returned by the backend.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createSessionStore)
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )
  const mountedRef = useRef(true)
  const revisionRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    const handleUnauthorized = () => {
      revisionRef.current += 1
      store.set({ session: null, error: null, loading: false })
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => {
      mountedRef.current = false
      window.removeEventListener('auth:unauthorized', handleUnauthorized)
    }
  }, [store])

  const refresh = useCallback(async () => {
    const revision = revisionRef.current
    store.set({ loading: true })
    try {
      const next = await authApi.session()
      if (!mountedRef.current || revision !== revisionRef.current) return
      store.set({ session: next, error: null })
    } catch (caught) {
      if (!mountedRef.current || revision !== revisionRef.current) return
      store.set({
        session: null,
        error:
          caught instanceof ApiError && caught.status === 401
            ? null
            : errorFrom(caught),
      })
    } finally {
      if (mountedRef.current && revision === revisionRef.current) {
        store.set({ loading: false })
      }
    }
  }, [store])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (input: LoginInput) => {
    revisionRef.current += 1
    try {
      const next = await authApi.login(input)
      store.set({ session: next, error: null })
      return next
    } finally {
      if (mountedRef.current) store.set({ loading: false })
    }
  }, [store])

  const logout = useCallback(async () => {
    revisionRef.current += 1
    try {
      await authApi.logout()
    } catch {
      // The local state must be cleared even when the network fails; the next
      // session check will confirm whether the cookie was revoked.
    } finally {
      store.set({ session: null, error: null })
      if (mountedRef.current) store.set({ loading: false })
    }
  }, [store])

  const value = useMemo(
    () => ({
      session: state.session,
      loading: state.loading,
      error: state.error,
      refresh,
      login,
      logout,
    }),
    [state.session, state.loading, state.error, refresh, login, logout],
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
