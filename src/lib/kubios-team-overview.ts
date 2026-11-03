import 'server-only'

import {
  DEFAULT_KUBIOS_TIMEOUT_MS,
  KUBIOS_API_ORIGIN,
  KUBIOS_USER_SELF_PATH,
  KubiosApiError,
  fetchKubiosUserSelf,
  type KubiosApiErrorCode,
  type KubiosApiFetch
} from './kubios-api-client'
import {
  KUBIOS_TARGET_TEAM_NAME,
  parseKubiosUserTeams,
  selectKubiosTeam,
  type KubiosTeam,
  type KubiosTeamResolutionReason
} from './kubios-team'

/**
 * K02/K31 - Cliente server-only de la vista de equipos de Kubios.
 *
 * `GET /v1/user/self` es la única fuente del `team_id` cuando no se aporta un
 * override explícito. El transporte, el timeout y los errores tipados viven en
 * `kubios-api-client`; este módulo añade la validación de `team_id + name` y la
 * selección explícita del equipo objetivo. El `id_token` nunca se registra, no
 * viaja en la URL y no se incluye en los resultados.
 *
 * `teamIdOverride` es opcional: si está presente se valida y se usa sin hacer
 * red (así `KUBIOS_TEAM_ID` puede seguir existiendo como override operativo).
 * Si falta, se consulta `/v1/user/self` y se selecciona exclusivamente
 * `Diabetes Tracker - H2TRAIN`; no hay fallback al primer equipo.
 */

export const KUBIOS_USER_SELF_URL = `${KUBIOS_API_ORIGIN}${KUBIOS_USER_SELF_PATH}`

/** Timeout por defecto de la consulta de equipos, en milisegundos. */
export const DEFAULT_KUBIOS_TEAM_TIMEOUT_MS = DEFAULT_KUBIOS_TIMEOUT_MS

/** Opciones de red reenviadas al cliente de la API. */
export interface KubiosTeamOverviewOptions {
  readonly fetch?: KubiosApiFetch
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/** Opciones de resolución de equipo. */
export interface ResolveKubiosTeamOptions extends KubiosTeamOverviewOptions {
  /**
   * Override explícito. Si se define, no se consulta `/v1/user/self`; un valor
   * vacío o con caracteres de control es `invalid_input`.
   */
  readonly teamIdOverride?: string
  /** Nombre alternativo solo para pruebas o configuraciones autorizadas. */
  readonly targetTeamName?: string
}

export type KubiosTeamErrorCode =
  | KubiosApiErrorCode
  | KubiosTeamResolutionReason

export interface KubiosTeamFailure {
  readonly ok: false
  readonly code: KubiosTeamErrorCode
  readonly status: number | null
  readonly retryAfterMs: number | null
}

export type KubiosTeamOverviewResult =
  | { readonly ok: true; readonly teams: readonly KubiosTeam[] }
  | KubiosTeamFailure

export type KubiosTeamResolveResult =
  | {
      readonly ok: true
      readonly teamId: string
      readonly teamName: string | null
      readonly source: 'override' | 'overview'
    }
  | KubiosTeamFailure

const MAX_IDENTIFIER_LENGTH = 256
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

function failure(
  code: KubiosTeamErrorCode,
  status: number | null = null,
  retryAfterMs: number | null = null
): KubiosTeamFailure {
  return { ok: false, code, status, retryAfterMs }
}

function isValidIdentifier(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) return false
  if (value !== value.trim()) return false
  return !CONTROL_CHARACTERS.test(value)
}

function mapApiError(error: unknown): KubiosTeamFailure {
  if (error instanceof KubiosApiError) {
    return failure(error.code, error.status, error.retryAfterMs)
  }
  return failure('network_error')
}

/**
 * Consulta `GET /v1/user/self` y devuelve los equipos validados de
 * `user.teams[]` (incluido `name`). No selecciona ninguno.
 */
export async function fetchKubiosTeamOverview(
  idToken: string,
  options: KubiosTeamOverviewOptions = {}
): Promise<KubiosTeamOverviewResult> {
  let page: Awaited<ReturnType<typeof fetchKubiosUserSelf>>
  try {
    page = await fetchKubiosUserSelf(idToken, options)
  } catch (error) {
    return mapApiError(error)
  }

  const parsed = parseKubiosUserTeams(page)
  if (!parsed.ok) return failure(parsed.reason, 200)

  return { ok: true, teams: parsed.teams }
}

/**
 * Resuelve el equipo de trabajo.
 *
 * Con `teamIdOverride` no hay red: se valida el valor y se devuelve como
 * `source: 'override'`. Sin override, se consulta `/v1/user/self`, se parsea
 * `user.teams[]` y se selecciona el nombre objetivo. Cualquier ausencia,
 * ambigüedad o respuesta inválida es un fallo cerrado.
 */
export async function resolveKubiosTeam(
  idToken: string,
  options: ResolveKubiosTeamOptions = {}
): Promise<KubiosTeamResolveResult> {
  if (options.teamIdOverride !== undefined) {
    if (!isValidIdentifier(options.teamIdOverride)) {
      return failure('invalid_input')
    }
    return {
      ok: true,
      teamId: options.teamIdOverride,
      teamName: null,
      source: 'override'
    }
  }

  const overview = await fetchKubiosTeamOverview(idToken, options)
  if (!overview.ok) return overview

  const selection = selectKubiosTeam(
    overview.teams,
    options.targetTeamName ?? KUBIOS_TARGET_TEAM_NAME
  )
  if (!selection.ok) return failure(selection.reason, 200)

  return {
    ok: true,
    teamId: selection.team.teamId,
    teamName: selection.team.name,
    source: 'overview'
  }
}
