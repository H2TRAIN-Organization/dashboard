'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/contexts/SessionContext'
import {
  buildKubiosFilterKey,
  buildKubiosHrvResultsQuery,
  classifyKubiosError,
  fetchKubiosHrvResults,
  fetchKubiosMe,
  isKubiosDataStatus,
  isKubiosPersonalVisible,
  sortKubiosResults,
  type KubiosDateFilter,
  type KubiosErrorKind,
  type KubiosHrvResults,
  type KubiosLatestResult,
  type KubiosMe,
  type KubiosStatus,
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
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (loading || sessionKey === null) return

    const controller = new AbortController()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const isStale = () =>
      controller.signal.aborted || requestIdRef.current !== requestId

    void fetchKubiosMe({ signal: controller.signal })
      .then((data) => {
        if (isStale()) return
        setState({
          ownerSessionKey: sessionKey,
          phase: 'data',
          data,
          error: null,
        })
      })
      .catch((caught: unknown) => {
        if (isStale()) return
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
    if (loading || sessionKey === null) return
    // Invalida cualquier respuesta anterior antes de que el efecto arranque la
    // petición nueva. El estado de carga se publica en el mismo clic para que
    // el botón y la vista respondan de inmediato, aunque el snapshot no cambie.
    requestIdRef.current += 1
    setState({
      ownerSessionKey: sessionKey,
      phase: 'loading',
      data: null,
      error: null,
    })
    setRevision((value) => value + 1)
  }, [loading, sessionKey])

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
  const requestIdRef = useRef(0)
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
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const isStale = () =>
      controller.signal.aborted || requestIdRef.current !== requestId

    void fetchKubiosHrvResults({ from, to }, { signal: controller.signal })
      .then((response) => {
        if (isStale()) return

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
        if (isStale()) return
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
    if (loading || sessionKey === null || query === null) return
    // Igual que en el resumen: se invalida la petición en curso y se publica
    // la carga inmediatamente. El rango activo se conserva en filterKey y es
    // el mismo que usa el efecto al volver a consultar.
    requestIdRef.current += 1
    setState({
      ownerSessionKey: sessionKey,
      filterKey,
      phase: 'loading',
      data: null,
      error: null,
    })
    setRevision((value) => value + 1)
  }, [filterKey, loading, query, sessionKey])

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

export type KubiosPersonalSource = 'results' | 'summary' | 'none'

export type KubiosErrorTranslationKey =
  | 'sessionExpired'
  | 'serviceUnavailable'
  | 'invalidDateRange'
  | 'invalidResponse'
  | 'loadError'

/** Misma traducción de error para la tarjeta y la vista /kubios. */
export function kubiosErrorTranslationKey(
  error: KubiosErrorKind | null,
): KubiosErrorTranslationKey {
  switch (error) {
    case 'unauthorized':
      return 'sessionExpired'
    case 'unavailable':
      return 'serviceUnavailable'
    case 'invalid-query':
      return 'invalidDateRange'
    case 'contract':
      return 'invalidResponse'
    default:
      return 'loadError'
  }
}

/**
 * Estado único que consumen la tarjeta y la vista /kubios. La lista de
 * resultados manda cuando existe; si falla, se conserva el resumen de /me
 * (recuento y última medición) junto al error, sin presentarlo como una serie
 * completa. Los estados vacío, pendiente y sin vincular no se rellenan con el
 * resumen de otra respuesta.
 */
export interface KubiosPersonalView {
  phase: KubiosPhase
  status: KubiosStatus | null
  results: KubiosLatestResult[]
  latest: KubiosLatestResult | null
  measurementCount: number
  syncedAt: string | null
  /** Error de la serie de resultados; puede convivir con un resumen en caché. */
  error: KubiosErrorKind | null
  source: KubiosPersonalSource
  available: boolean
  hasResults: boolean
  stale: boolean
}

function emptyPersonalView(phase: KubiosPhase): KubiosPersonalView {
  return {
    phase,
    status: null,
    results: [],
    latest: null,
    measurementCount: 0,
    syncedAt: null,
    error: null,
    source: 'none',
    available: false,
    hasResults: false,
    stale: false,
  }
}

export function deriveKubiosPersonalView(
  me: KubiosMeView,
  hrv: KubiosResultsView,
  filterActive: boolean,
): KubiosPersonalView {
  const meData = me.phase === 'data' ? me.data : null
  const summaryData =
    meData !== null &&
    isKubiosPersonalVisible(meData.status, meData.measurement_count)
      ? meData
      : null
  const resultsData = hrv.phase === 'data' ? hrv.data : null

  if (resultsData !== null) {
    const status = resultsData.status
    const results = sortKubiosResults(resultsData.results)
    // El resumen global solo completa el estado de datos (ready/stale); un
    // estado vacío/pendiente/sin vincular no se convierte en una serie falsa.
    const summary =
      summaryData !== null && isKubiosDataStatus(status) ? summaryData : null
    const measurementCount = filterActive
      ? results.length
      : summary !== null
        ? summary.measurement_count
        : results.length
    const latest = filterActive
      ? (results[0] ?? null)
      : ((summary?.latest_result ?? null) ?? results[0] ?? null)
    const syncedAt = resultsData.synced_at ?? summary?.synced_at ?? null

    return {
      phase: 'data',
      status,
      results,
      latest,
      measurementCount,
      syncedAt,
      error: null,
      source:
        results.length > 0 ? 'results' : summary !== null ? 'summary' : 'none',
      available: isKubiosPersonalVisible(status, measurementCount),
      hasResults: results.length > 0,
      stale: status === 'stale',
    }
  }

  if (hrv.phase === 'error') {
    // /me is an unfiltered snapshot. It cannot stand in for a failed range
    // query without attributing global measurements to that range.
    if (summaryData !== null && !filterActive) {
      const status = summaryData.status
      return {
        phase: 'data',
        status,
        results: [],
        latest: summaryData.latest_result,
        measurementCount: summaryData.measurement_count,
        syncedAt: summaryData.synced_at,
        error: hrv.error,
        source: 'summary',
        available: isKubiosPersonalVisible(
          status,
          summaryData.measurement_count,
        ),
        hasResults: false,
        stale: status === 'stale',
      }
    }

    // Mientras /me puede aportar el resumen, no se declara el error definitivo.
    if (me.phase === 'loading' || me.phase === 'idle') {
      return emptyPersonalView('loading')
    }

    return { ...emptyPersonalView('error'), error: hrv.error }
  }

  if (hrv.phase === 'data') {
    return { ...emptyPersonalView('error'), error: 'contract' }
  }

  if (hrv.phase === 'idle' && me.phase === 'idle') {
    return emptyPersonalView('idle')
  }

  return emptyPersonalView('loading')
}

/**
 * Compone ambos endpoints en una sola vista. La tarjeta y la página usan esta
 * misma derivación, de modo que la presencia del resumen y el error de la serie
 * no pueden divergir. Al cambiar de sesión, ambos hooks descartan su estado y
 * la vista pasa por carga antes de aceptar la identidad nueva.
 */
export function useKubiosPersonal(filter: KubiosDateFilter) {
  const me = useKubiosMe()
  const hrv = useKubiosHrvResults(filter)
  const filterActive = filter.from.trim().length > 0 || filter.to.trim().length > 0
  const view = deriveKubiosPersonalView(me.view, hrv.view, filterActive)
  const reloadMe = me.reload
  const reloadResults = hrv.reload

  const reload = useCallback(() => {
    reloadMe()
    reloadResults()
  }, [reloadMe, reloadResults])

  return { view, reload }
}
