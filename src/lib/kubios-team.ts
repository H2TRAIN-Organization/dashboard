/**
 * K02/K31 - Parseo y selección determinista del equipo de Kubios.
 *
 * La respuesta de `GET /v1/user/self` contiene `user.teams[]`. Este módulo no
 * hace red: valida esa estructura y selecciona exclusivamente el equipo
 * `Diabetes Tracker - H2TRAIN`. No existe fallback al primer equipo: si el
 * nombre no aparece, o aparece más de una vez con identificadores distintos, la
 * selección falla cerrada.
 *
 * El identificador de equipo se trata como cadena opaca (la API no garantiza
 * aquí su formato). La validación UUID, si aplica, corresponde a la capa que
 * escribe en PostgreSQL.
 */

/** Nombre exacto del equipo que debe usarse en esta aplicación. */
export const KUBIOS_TARGET_TEAM_NAME = 'Diabetes Tracker - H2TRAIN'

const MAX_TEAM_ID_LENGTH = 256
const MAX_TEAM_NAME_LENGTH = 512
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

/** Equipo ya validado, con el nombre recortado. */
export interface KubiosTeam {
  readonly teamId: string
  readonly name: string
}

export type KubiosTeamParseReason = 'invalid_response_shape'

export type KubiosTeamSelectionReason =
  | 'invalid_target'
  | 'invalid_teams'
  | 'team_not_found'
  | 'team_ambiguous'

export type KubiosTeamResolutionReason =
  | KubiosTeamParseReason
  | KubiosTeamSelectionReason

export type KubiosTeamParseResult =
  | { readonly ok: true; readonly teams: readonly KubiosTeam[] }
  | { readonly ok: false; readonly reason: KubiosTeamParseReason }

export type KubiosTeamSelection =
  | { readonly ok: true; readonly team: KubiosTeam }
  | { readonly ok: false; readonly reason: KubiosTeamSelectionReason }

export type KubiosTeamResolution =
  | { readonly ok: true; readonly team: KubiosTeam }
  | { readonly ok: false; readonly reason: KubiosTeamResolutionReason }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidTeamId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_TEAM_ID_LENGTH) return false
  if (value !== value.trim()) return false
  return !CONTROL_CHARACTERS.test(value)
}

function isValidTeamName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TEAM_NAME_LENGTH) return false
  return !CONTROL_CHARACTERS.test(value)
}

function isKubiosTeam(value: unknown): value is KubiosTeam {
  return (
    isPlainRecord(value) &&
    isValidTeamId(value.teamId) &&
    isValidTeamName(value.name)
  )
}

/**
 * Normaliza solo para comparar: recorta extremos, colapsa espacios internos y
 * no distingue mayúsculas. El nombre devuelto por `parseKubiosUserTeams` sí
 * conserva su forma original salvo el recorte de extremos.
 */
function normalizeTeamName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

/**
 * Valida `GET /v1/user/self` y extrae `user.teams[]`.
 *
 * Una entrada mal formada invalida la respuesta completa: no se descartan
 * equipos en silencio. Un array vacío es válido y se resolverá como
 * `team_not_found` al seleccionar.
 */
export function parseKubiosUserTeams(body: unknown): KubiosTeamParseResult {
  if (!isPlainRecord(body)) {
    return { ok: false, reason: 'invalid_response_shape' }
  }

  const user = body.user
  if (!isPlainRecord(user) || !Array.isArray(user.teams)) {
    return { ok: false, reason: 'invalid_response_shape' }
  }

  const teams: KubiosTeam[] = []

  for (const candidate of user.teams) {
    if (!isPlainRecord(candidate)) {
      return { ok: false, reason: 'invalid_response_shape' }
    }

    const teamId = candidate.team_id
    const name = candidate.name

    if (!isValidTeamId(teamId) || !isValidTeamName(name)) {
      return { ok: false, reason: 'invalid_response_shape' }
    }

    teams.push({ teamId, name: name.trim() })
  }

  return { ok: true, teams }
}

/**
 * Selecciona el equipo cuyo nombre coincide con `targetName` (por defecto
 * `Diabetes Tracker - H2TRAIN`).
 *
 * - Sin coincidencias: `team_not_found`; nunca se usa el primer equipo.
 * - Varias coincidencias con identificadores distintos: `team_ambiguous`.
 * - Varias entradas idénticas del mismo equipo: se acepta la primera.
 */
export function selectKubiosTeam(
  teams: readonly KubiosTeam[],
  targetName: string = KUBIOS_TARGET_TEAM_NAME
): KubiosTeamSelection {
  if (
    typeof targetName !== 'string' ||
    targetName.trim().length === 0 ||
    targetName.trim().length > MAX_TEAM_NAME_LENGTH ||
    CONTROL_CHARACTERS.test(targetName)
  ) {
    return { ok: false, reason: 'invalid_target' }
  }

  if (!Array.isArray(teams)) {
    return { ok: false, reason: 'invalid_teams' }
  }

  const wanted = normalizeTeamName(targetName)
  const matches: KubiosTeam[] = []

  for (const team of teams) {
    if (!isKubiosTeam(team)) {
      return { ok: false, reason: 'invalid_teams' }
    }

    if (normalizeTeamName(team.name) === wanted) {
      matches.push(team)
    }
  }

  if (matches.length === 0) {
    return { ok: false, reason: 'team_not_found' }
  }

  const distinctIds = new Set(matches.map((team) => team.teamId))
  if (distinctIds.size !== 1) {
    return { ok: false, reason: 'team_ambiguous' }
  }

  const selected = matches[0]
  if (selected === undefined) {
    return { ok: false, reason: 'team_not_found' }
  }

  return { ok: true, team: selected }
}

/**
 * Une parseo y selección sin red. Es la función que deben usar los servicios
 * que ya tienen la respuesta de `/v1/user/self` en memoria.
 */
export function resolveKubiosTeamFromUserInfo(
  body: unknown,
  targetName: string = KUBIOS_TARGET_TEAM_NAME
): KubiosTeamResolution {
  const parsed = parseKubiosUserTeams(body)
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason }
  }

  const selection = selectKubiosTeam(parsed.teams, targetName)
  if (!selection.ok) {
    return { ok: false, reason: selection.reason }
  }

  return { ok: true, team: selection.team }
}
