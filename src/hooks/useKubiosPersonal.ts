'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/contexts/SessionContext'
import {
  buildKubiosFilterKey,
  buildKubiosHrvResultsQuery,
  classifyKubiosError,
  fetchKubiosHrvResults,
  fetchKubiosMe,
  type KubiosDateFilter,
  type KubiosErrorKind,
  type KubiosHrvResults,
  type KubiosLatestResult,
  type KubiosMe,
} from '@/lib/kubios-personal'

export type KubiosPhase = 'idle' | 'loading' | 'data' | 'error'

export interface KubiosMeView {
  phase: KubiosPhase
  data: KubiosMe | null
  error: KubiosErrorKind | null
}

export interface KubiosResultsView {
  phase: KubiosPhase
  data: KubiosHrvResults | null
  error: KubiosErrorKind | null
}

interface MeState {
  ownerSessionKey: string | null
  phase: KubiosPhase
  data: KubiosMe | null
  error: KubiosErrorKind | null
}

interface ResultsState {
  ownerSessionKey: string | null
  filterKey: string
  phase: KubiosPhase
  data: KubiosHrvResults | null
  error: KubiosErrorKind | null
}

const IDLE_ME: MeState = {
  ownerSessionKey: null,
  phase: 'idle',
  data: null,
  error: null,
}

/**
 * Clave de la sesión verificada. La identidad del objeto de sesión cambia al
 * iniciar o cerrar sesión, así que un nuevo inicio con el mismo usuario nunca
 * reutiliza el estado anterior ni durante el render previo al efecto.
 */
const sessionScopes = new WeakMap<object, number>()
let nextSessionScope = 0

function sessionScopeKey(session: { user: { id: string } } | null): string | null {
  if (session === null) return null

  let scope = sessionScopes.get(session)
  if (scope === undefined) {
    nextSessionScope += 1
    scope = nextSessionScope
    sessionScopes.set(session, scope)
  }

  return `${session.user.id}\u0000${scope}`
}

/**
 * Resumen propio de Kubios. Cada cambio de sesión cancela la petición anterior
 * y oculta inmediatamente el estado de la sesión previa (no hay caché, token ni
 * almacenamiento local).
 */
export function useKubiosMe() {
  const { session, loading } = useSession()
  const sessionKey = sessionScopeKey(session)
  const [state, setState] = useState<MeState>(IDLE_ME)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (loading || sessionKey === null) return

    const controller = new AbortController()

    void fetchKubiosMe({ signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        setState({
          ownerSessionKey: sessionKey,
          phase: 'data',
          data,
          error: null,
        })
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        const error = classifyKubiosError(caught)
        if (error === 'aborted') return
        setState({
          ownerSessionKey: sessionKey,
          phase: 'error',
          data: null,
          error,
        })
      })

    return () => {
      controller.abort()
    }
  }, [sessionKey, loading, revision])

  const reload = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])

  const isCurrent = state.ownerSessionKey === sessionKey
  const view: KubiosMeView = isCurrent
    ? { phase: state.phase, data: state.data, error: state.error }
    : {
        phase: sessionKey === null ? 'idle' : 'loading',
        data: null,
        error: null,
      }

  return { view, reload }
}

/**
 * Resultados HRV propios con filtro de fechas. Al cambiar sesión o filtro se
 * aborta la petición anterior y se descarta cualquier respuesta que ya no
 * pertenezca a la clave actual. Si el servidor devuelve `stale` sin filas se
 * conserva el último snapshot válido de esa misma sesión y filtro; nunca se
 * reutiliza el de otra sesión u otro rango.
 */
export function useKubiosHrvResults(filter: KubiosDateFilter) {
  const { session, loading } = useSession()
  const sessionKey = sessionScopeKey(session)
  const filterKey = buildKubiosFilterKey(filter)
  const query = buildKubiosHrvResultsQuery(filter)
  const from = filter.from
  const to = filter.to

  const [state, setState] = useState<ResultsState>({
    ownerSessionKey: null,
    filterKey,
    phase: 'idle',
    data: null,
    error: null,
  })
  const [revision, setRevision] = useState(0)
  const snapshotRef = useRef<{
    key: string
    results: KubiosLatestResult[]
  } | null>(null)

  useEffect(() => {
    if (loading) return

    if (sessionKey === null) {
      snapshotRef.current = null
      return
    }

    const ownerKey = `${sessionKey}\u0000${filterKey}`

    if (
      snapshotRef.current !== null &&
      !snapshotRef.current.key.startsWith(`${sessionKey}\u0000`)
    ) {
      snapshotRef.current = null
    }

    if (query === null) return

    const controller = new AbortController()

    void fetchKubiosHrvResults({ from, to }, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return

        let results = response.results
        if (
          results.length === 0 &&
          response.status === 'stale' &&
          snapshotRef.current !== null &&
          snapshotRef.current.key === ownerKey
        ) {
          results = snapshotRef.current.results
        }

        if (
          results.length > 0 &&
          (response.status === 'ready' || response.status === 'stale')
        ) {
          snapshotRef.current = { key: ownerKey, results }
        }

        setState({
          ownerSessionKey: sessionKey,
          filterKey,
          phase: 'data',
          data: { ...response, results },
          error: null,
        })
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        const error = classifyKubiosError(caught)
        if (error === 'aborted') return
        setState({
          ownerSessionKey: sessionKey,
          filterKey,
          phase: 'error',
          data: null,
          error,
        })
      })

    return () => {
      controller.abort()
    }
  }, [sessionKey, loading, from, to, filterKey, query, revision])

  const reload = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])

  const isCurrent =
    state.ownerSessionKey === sessionKey && state.filterKey === filterKey
  const view: KubiosResultsView =
    sessionKey === null
      ? { phase: 'idle', data: null, error: null }
      : query === null
        ? { phase: 'error', data: null, error: 'invalid-query' }
        : isCurrent
          ? { phase: state.phase, data: state.data, error: state.error }
          : { phase: 'loading', data: null, error: null }

  return { view, reload }
}
