'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/api-client'
import {
  fetchAllAdminKubiosParticipants,
  fetchAdminKubiosVisiblePage,
  syncAdminKubiosParticipant,
  type AdminKubiosMeasurement,
  type AdminKubiosPageStatus,
  type AdminKubiosParticipant,
  type AdminKubiosSyncResult,
} from './api'

/**
 * Estado de la vista administrativa de Kubios.
 *
 * Cada cambio de selección cancela la petición anterior y comprueba su
 * secuencia antes de aplicar la respuesta, de modo que una respuesta lenta de
 * otro participante (o de una sesión cerrada) nunca sustituya la vista actual.
 */

export interface AdminKubiosParticipantsState {
  participants: AdminKubiosParticipant[]
  loading: boolean
  error: string | null
}

export interface AdminKubiosPageState {
  phase: 'loading' | 'ready' | 'error'
  /** Selección a la que pertenece la página; evita mostrar datos ajenos un frame. */
  ownerUserId: number | null
  measurements: AdminKubiosMeasurement[]
  status: AdminKubiosPageStatus | null
  nextCursor: string | null
  cursor: string | null
  history: Array<string | null>
  unavailableCount: number
  error: string | null
}

const INITIAL_PARTICIPANTS: AdminKubiosParticipantsState = {
  participants: [],
  loading: true,
  error: null,
}

const INITIAL_PAGE: AdminKubiosPageState = {
  phase: 'loading',
  ownerUserId: null,
  measurements: [],
  status: null,
  nextCursor: null,
  cursor: null,
  history: [],
  unavailableCount: 0,
  error: null,
}

/** Mensajes honestos del refresco: cada estado del servidor tiene su texto. */
export type AdminKubiosSyncMessageKey =
  | 'syncDone'
  | 'syncPartial'
  | 'syncLocked'
  | 'syncThrottled'
  | 'syncError'

export interface AdminKubiosSyncState {
  phase: 'idle' | 'busy' | 'done' | 'error'
  message: AdminKubiosSyncMessageKey | null
}

/** El estado del refresco solo cuenta al participante seleccionado. */
export const ADMIN_KUBIOS_SYNC_RESET: AdminKubiosSyncState = {
  phase: 'idle',
  message: null,
}

const INITIAL_SYNC: AdminKubiosSyncState = ADMIN_KUBIOS_SYNC_RESET

function adminKubiosSyncMessageKey(
  result: AdminKubiosSyncResult,
): AdminKubiosSyncMessageKey {
  switch (result.status) {
    case 'ok':
      return 'syncDone'
    case 'locked':
      return 'syncLocked'
    case 'throttled':
      return 'syncThrottled'
    default:
      return 'syncPartial'
  }
}

function kubiosErrorToSyncMessage(): AdminKubiosSyncMessageKey {
  return 'syncError'
}

export function useAdminKubios(enabled: boolean, selectedUserId: number | null) {
  const [participantsState, setParticipantsState] =
    useState<AdminKubiosParticipantsState>(INITIAL_PARTICIPANTS)
  const [page, setPage] = useState<AdminKubiosPageState>(INITIAL_PAGE)
  const [participantsReloadKey, setParticipantsReloadKey] = useState(0)
  // El refresco dirigido pertenece al participante seleccionado viviente.
  const [sync, setSync] = useState<AdminKubiosSyncState>(INITIAL_SYNC)
  const [syncTarget, setSyncTarget] = useState<number | null>(null)
  // El refresco manual pertenece al participante seleccionado: un cambio de
  // selección borra cualquier mensaje anterior (reinicio derivado del render,
  // el patrón oficial de React para restablecer estado con una clave lógica).
  if (syncTarget !== selectedUserId) {
    setSyncTarget(selectedUserId)
    setSync(ADMIN_KUBIOS_SYNC_RESET)
  }

  const pageRef = useRef(page)
  const participantsRequestRef = useRef(0)
  const participantsAbortRef = useRef<AbortController | null>(null)
  const measurementsRequestRef = useRef(0)
  const measurementsAbortRef = useRef<AbortController | null>(null)

  const updatePage = useCallback((next: AdminKubiosPageState) => {
    pageRef.current = next
    setPage(next)
  }, [])

  const loadMeasurements = useCallback(
    async (
      userId: number | null,
      startCursor: string | null,
      history: Array<string | null>,
    ) => {
      const requestId = measurementsRequestRef.current + 1
      measurementsRequestRef.current = requestId
      measurementsAbortRef.current?.abort()
      const controller = new AbortController()
      measurementsAbortRef.current = controller

      updatePage({
        ...INITIAL_PAGE,
        ownerUserId: userId,
        cursor: startCursor,
        history,
      })

      try {
        const visible = await fetchAdminKubiosVisiblePage(
          userId,
          startCursor,
          { signal: controller.signal },
        )
        if (requestId !== measurementsRequestRef.current) return
        if (controller.signal.aborted) return

        // Un 409 reinicia la lectura en la primera página: la historia
        // anterior ya no representa posiciones válidas del cursor.
        const restarted = startCursor !== null && visible.cursor === null
        updatePage({
          phase: 'ready',
          ownerUserId: userId,
          measurements: visible.page.measurements,
          status: visible.page.status,
          nextCursor: visible.page.nextCursor,
          cursor: visible.cursor,
          history: restarted ? [] : history,
          unavailableCount: visible.page.unavailableCount,
          error: null,
        })
      } catch (caught) {
        if (requestId !== measurementsRequestRef.current) return
        if (caught instanceof Error && caught.name === 'AbortError') return
        updatePage({
          ...INITIAL_PAGE,
          phase: 'error',
          ownerUserId: userId,
          cursor: startCursor,
          history,
          error: errorMessage(caught),
        })
      } finally {
        if (requestId === measurementsRequestRef.current) {
          measurementsAbortRef.current = null
        }
      }
    },
    [updatePage],
  )

  // Carga completa de participantes: la búsqueda local necesita todas las
  // páginas, no solo la primera.
  useEffect(() => {
    if (!enabled) return

    const requestId = participantsRequestRef.current + 1
    participantsRequestRef.current = requestId
    participantsAbortRef.current?.abort()
    const controller = new AbortController()
    participantsAbortRef.current = controller
    let active = true

    const load = async () => {
      // Yield once so the effect body does not synchronously set state.
      await Promise.resolve()
      if (!active) return
      setParticipantsState({ participants: [], loading: true, error: null })

      try {
        const participants = await fetchAllAdminKubiosParticipants({
          signal: controller.signal,
        })
        if (!active || requestId !== participantsRequestRef.current) return
        setParticipantsState({ participants, loading: false, error: null })
      } catch (caught) {
        if (!active || requestId !== participantsRequestRef.current) return
        if (caught instanceof Error && caught.name === 'AbortError') return
        setParticipantsState({
          participants: [],
          loading: false,
          error: errorMessage(caught),
        })
      }
    }

    void load()

    return () => {
      active = false
      participantsRequestRef.current += 1
      controller.abort()
      participantsAbortRef.current = null
    }
  }, [enabled, participantsReloadKey])

  // La primera página se recarga al cambiar de participante o al montar la
  // vista. El cleanup cancela cualquier respuesta pendiente de la selección
  // anterior para que no pueda mostrarse.
  useEffect(() => {
    if (!enabled) return

    let active = true
    const load = async () => {
      await Promise.resolve()
      if (!active) return
      await loadMeasurements(selectedUserId, null, [])
    }
    void load()

    return () => {
      active = false
      measurementsRequestRef.current += 1
      measurementsAbortRef.current?.abort()
      measurementsAbortRef.current = null
    }
  }, [enabled, selectedUserId, loadMeasurements])

  const goNext = useCallback(() => {
    const current = pageRef.current
    if (current.phase === 'loading' || current.nextCursor === null) return
    const history = [...current.history, current.cursor]
    void loadMeasurements(selectedUserId, current.nextCursor, history)
  }, [loadMeasurements, selectedUserId])

  const goPrevious = useCallback(() => {
    const current = pageRef.current
    if (current.phase === 'loading' || current.history.length === 0) return
    const target = current.history[current.history.length - 1]
    const history = current.history.slice(0, -1)
    void loadMeasurements(selectedUserId, target, history)
  }, [loadMeasurements, selectedUserId])

  const reloadMeasurements = useCallback(() => {
    void loadMeasurements(selectedUserId, null, [])
  }, [loadMeasurements, selectedUserId])

  const reloadParticipants = useCallback(() => {
    setParticipantsReloadKey((current) => current + 1)
  }, [])

  const syncRequestRef = useRef(0)

  /**
   * Refresco dirigido del participante seleccionado. Mientras dura, el estado
   * queda publicado en el mismo clic y la vista se recarga al terminar para
   * que la copia y los estados ready/stale reflejen lo obtenido ahora mismo.
   */
  const syncParticipant = useCallback(async () => {
    if (selectedUserId === null) return
    const requestId = syncRequestRef.current + 1
    syncRequestRef.current = requestId
    setSync({ phase: 'busy', message: null })

    try {
      const result = await syncAdminKubiosParticipant(selectedUserId)
      if (syncRequestRef.current !== requestId) return
      setSync({
        phase: 'done',
        message: adminKubiosSyncMessageKey(result),
      })
      reloadMeasurements()
      reloadParticipants()
    } catch (caught) {
      if (syncRequestRef.current !== requestId) return
      if (caught instanceof Error && caught.name === 'AbortError') return
      setSync({
        phase: 'error',
        message: kubiosErrorToSyncMessage(),
      })
    }
  }, [reloadMeasurements, reloadParticipants, selectedUserId])

  return {
    participantsState,
    page,
    goNext,
    goPrevious,
    reloadMeasurements,
    reloadParticipants,
    sync,
    syncParticipant,
  }
}
