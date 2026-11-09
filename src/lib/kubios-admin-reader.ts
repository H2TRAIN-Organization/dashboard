import 'server-only'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { canReadAdminDatabase } from '@/server/domain/access-policy'
import {
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
  ValidationError,
} from '@/server/domain/errors'
import { isUserRole, type ActiveActor } from '@/server/domain/user'
import {
  KUBIOS_SNAPSHOT_STALE_AFTER_MS,
  parseKubiosSnapshotPayload,
  parseKubiosValidatedSnapshotRow,
  readKubiosResultTimestamp,
} from './kubios-snapshot-reader'

/**
 * AK-02 - Lectura administrativa de participantes y snapshots Kubios.
 *
 * Este módulo no lee cookies, no crea clientes y no registra nada. El guard
 * real (sesión recargada desde la base y rol admin) se ejecuta antes de crear
 * el cliente de servicio; aquí se vuelve a comprobar la capacidad como defensa
 * en profundidad. Los datos descifrados nunca se devuelven en crudo: solo los
 * campos del contrato y una lista blanca de métricas numéricas finitas.
 *
 * Listados:
 *   * participants: cursor after exclusivo sobre UserID, máximo 100.
 *   * measurements global: usuarios ascendentes y, dentro de cada uno,
 *     `measured_timestamp` descendente; máximo 50 filas y 8 snapshots
 *     escaneados, con una fila adicional de lookahead.
 *   * measurements seleccionado: un único vínculo; pending/empty/ready/stale/
 *     unlinked. Un cursor cuyo snapshot o vínculo cambió responde 409.
 */

const PARTICIPANTS_RPC = 'kubios_admin_list_participants'
const SNAPSHOTS_RPC = 'kubios_admin_list_snapshots'

const PARTICIPANTS_LIMIT = 100
const SNAPSHOT_SCAN_LIMIT = 8
const SNAPSHOT_REQUEST_LIMIT = SNAPSHOT_SCAN_LIMIT + 1
const MEASUREMENT_LIMIT = 50

const POSTGRES_INTEGER_MAX = 2_147_483_647
const CANONICAL_USER_ID_PATTERN = /^[1-9]\d{0,9}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const HASH_PATTERN = /^[0-9a-f]{32}$/
const CURSOR_VERSION = 1
const MAX_CURSOR_LENGTH = 1024
const MAX_CURSOR_RESULT_INDEX = 1_000_000

const TOP_LEVEL_METRIC_KEYS = [
  'readiness',
  'mean_hr_bpm',
  'rmssd_ms',
  'pns_index',
  'sns_index',
  'physiological_age',
  'respiratory_rate',
  'stress_index',
] as const

const FREQUENCY_METRIC_KEYS = [
  'HF_power',
  'LF_power',
  'VLF_power',
  'tot_power',
] as const

export type KubiosAdminCryptoEnv = Record<string, string | undefined>

export interface KubiosAdminServiceClient {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<unknown>
}

export interface KubiosAdminSnapshotScope {
  readonly teamId: string
  readonly memberId: string
}

export interface KubiosAdminDecryptOptions {
  readonly env: KubiosAdminCryptoEnv
}

export type KubiosAdminDecrypt = (
  envelope: string,
  scope: KubiosAdminSnapshotScope,
  options: KubiosAdminDecryptOptions,
) => string

export interface KubiosAdminDeps {
  readonly createService: () => KubiosAdminServiceClient
  readonly decryptSnapshot: KubiosAdminDecrypt
  readonly cryptoEnv: KubiosAdminCryptoEnv
  readonly now?: () => Date
}

export interface KubiosAdminRequestLike {
  readonly actor: ActiveActor
  readonly url: string
}

export type KubiosAdminMeasurementStatus = 'ready' | 'stale'

export type KubiosAdminMeasurementsStatus =
  | 'ready'
  | 'stale'
  | 'pending'
  | 'empty'
  | 'unlinked'

export interface KubiosAdminParticipant {
  readonly userId: number
  readonly username: string
}

export interface KubiosAdminMeasurement {
  readonly userId: number
  readonly username: string
  readonly measuredTimestamp: string | null
  readonly metrics: Record<string, number>
  readonly syncedAt: string
  readonly status: KubiosAdminMeasurementStatus
}

export interface KubiosAdminParticipantsBody {
  readonly participants: readonly KubiosAdminParticipant[]
  readonly nextCursor: string | null
}

export interface KubiosAdminMeasurementsBody {
  readonly measurements: readonly KubiosAdminMeasurement[]
  readonly nextCursor: string | null
  readonly status: KubiosAdminMeasurementsStatus
  readonly unavailableCount: number
}

interface ParsedTimestamp {
  readonly ms: number
  readonly iso: string
}

interface SnapshotAccount {
  readonly userId: number
  readonly username: string
}

interface SnapshotIdentity extends SnapshotAccount {
  readonly teamId: string
  readonly memberId: string
  readonly updatedAt: ParsedTimestamp | null
}

interface ParticipantsCursor {
  readonly kind: 'participants'
  readonly afterUserId: number
  readonly anchorHash: string
}

interface GlobalMeasurementsCursor {
  readonly kind: 'global'
  readonly userId: number
  readonly nextIndex: number
  readonly anchorHash: string
}

interface SelectedMeasurementsCursor {
  readonly kind: 'selected'
  readonly userId: number
  readonly nextIndex: number
  readonly anchorHash: string
}

type MeasurementsCursor = GlobalMeasurementsCursor | SelectedMeasurementsCursor

interface ParsedParticipantsQuery {
  readonly cursor: ParticipantsCursor | null
}

interface ParsedMeasurementsQuery {
  readonly userId: number | null
  readonly cursor: MeasurementsCursor | null
}

interface GlobalAnchor {
  readonly identity: SnapshotIdentity
  readonly nextIndex: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined
}

function hasExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(record)
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  )
}

function invalidQuery(): ValidationError {
  return new ValidationError('La consulta administrativa de Kubios no es válida')
}

function cursorConflict(): ConflictError {
  return new ConflictError(
    'CONFLICT',
    'El cursor ya no es válido; reinicie la consulta',
  )
}

function unavailable(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    'El servicio administrativo de Kubios no está disponible',
  )
}

function isActiveActor(value: unknown): value is ActiveActor {
  return (
    isRecord(value) &&
    typeof value.userId === 'string' &&
    typeof value.username === 'string' &&
    typeof value.role === 'string' &&
    isUserRole(value.role)
  )
}

/** Guard de defensa en profundidad; se ejecuta antes de cualquier RPC. */
function assertAdminActor(actor: unknown): asserts actor is ActiveActor {
  if (!isActiveActor(actor) || !canReadAdminDatabase(actor)) {
    throw new ForbiddenError('Solo un administrador puede consultar Kubios')
  }
}

function parsePostgresUserId(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > POSTGRES_INTEGER_MAX
  ) {
    return null
  }
  return value
}

function parseQueryUserId(value: unknown): number | null {
  if (typeof value !== 'string' || !CANONICAL_USER_ID_PATTERN.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= POSTGRES_INTEGER_MAX
    ? parsed
    : null
}

function parseUsername(value: unknown): string | null {
  if (!isNonEmptyString(value) || value.length > 100) {
    return null
  }
  return value
}

function normalizeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null
}

function parseTimestamp(value: unknown): ParsedTimestamp | null {
  if (typeof value !== 'string') {
    return null
  }
  const raw = value.trim()
  if (!DATE_TIME_PATTERN.test(raw)) {
    return null
  }
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? { ms, iso: new Date(ms).toISOString() } : null
}

function parseSnapshotAccount(row: unknown): SnapshotAccount | null {
  if (!isRecord(row)) {
    return null
  }

  const userId = parsePostgresUserId(row.user_id)
  const username = parseUsername(row.username)
  if (userId === null || username === null) {
    return null
  }

  return { userId, username }
}

function parseSnapshotIdentity(row: unknown): SnapshotIdentity | null {
  const account = parseSnapshotAccount(row)
  if (account === null || !isRecord(row)) {
    return null
  }

  const teamId = normalizeUuid(row.team_id)
  const memberId = normalizeUuid(row.member_id)
  if (teamId === null || memberId === null) {
    return null
  }

  return {
    ...account,
    teamId,
    memberId,
    updatedAt: parseTimestamp(row.updated_at),
  }
}

/**
 * El LEFT JOIN del RPC seleccionado devuelve un vínculo pendiente con todos los
 * campos del snapshot a NULL, incluidos team_id y member_id (proceden del
 * snapshot, no del vínculo). Solo esa combinación completa es `pending`.
 */
function isPendingSnapshotRow(row: unknown): boolean {
  if (!isRecord(row)) {
    return false
  }

  return (
    isNullish(row.team_id) &&
    isNullish(row.member_id) &&
    isNullish(row.ciphertext) &&
    isNullish(row.nonce) &&
    isNullish(row.tag) &&
    isNullish(row.key_version) &&
    isNullish(row.updated_at)
  )
}

function hashCursorState(parts: readonly (string | number)[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts), 'utf8')
    .digest('hex')
    .slice(0, 32)
}

function participantAnchorHash(participant: KubiosAdminParticipant): string {
  return hashCursorState([
    'kubios-admin-participant-v1',
    participant.userId,
    participant.username,
  ])
}

function snapshotAnchorHash(identity: SnapshotIdentity): string | null {
  if (identity.updatedAt === null) {
    return null
  }

  return hashCursorState([
    'kubios-admin-snapshot-v1',
    identity.userId,
    identity.username,
    identity.teamId,
    identity.memberId,
    identity.updatedAt.iso,
  ])
}

function encodeCursor(payload: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursorRecord(value: string): Record<string, unknown> | null {
  if (
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(value)
  ) {
    return null
  }

  const buffer = Buffer.from(value, 'base64url')
  if (buffer.length === 0 || buffer.toString('base64url') !== value) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(buffer.toString('utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseCursorInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return null
  }
  return value
}

function parseParticipantsCursor(value: string): ParticipantsCursor | null {
  const record = decodeCursorRecord(value)
  if (
    record === null ||
    !hasExactKeys(record, ['v', 'k', 'u', 'h']) ||
    record.v !== CURSOR_VERSION ||
    record.k !== 'p'
  ) {
    return null
  }

  const afterUserId = parseCursorInteger(record.u, 1, POSTGRES_INTEGER_MAX)
  const anchorHash = record.h
  if (
    afterUserId === null ||
    typeof anchorHash !== 'string' ||
    !HASH_PATTERN.test(anchorHash)
  ) {
    return null
  }

  return { kind: 'participants', afterUserId, anchorHash }
}

function parseMeasurementsCursor(value: string): MeasurementsCursor | null {
  const record = decodeCursorRecord(value)
  if (
    record === null ||
    !hasExactKeys(record, ['v', 'k', 'u', 'i', 'h']) ||
    record.v !== CURSOR_VERSION
  ) {
    return null
  }

  const userId = parseCursorInteger(record.u, 1, POSTGRES_INTEGER_MAX)
  const nextIndex = parseCursorInteger(
    record.i,
    0,
    MAX_CURSOR_RESULT_INDEX,
  )
  const anchorHash = record.h
  if (
    userId === null ||
    nextIndex === null ||
    typeof anchorHash !== 'string' ||
    !HASH_PATTERN.test(anchorHash)
  ) {
    return null
  }

  if (record.k === 'g') {
    return { kind: 'global', userId, nextIndex, anchorHash }
  }
  if (record.k === 'u') {
    return { kind: 'selected', userId, nextIndex, anchorHash }
  }
  return null
}

function parseParticipantsQuery(urlValue: string): ParsedParticipantsQuery {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    throw invalidQuery()
  }

  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    if (key !== 'cursor' || values.length !== 1 || values[0] === '') {
      throw invalidQuery()
    }
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue === null) {
    return { cursor: null }
  }

  const cursor = parseParticipantsCursor(cursorValue)
  if (cursor === null) {
    throw invalidQuery()
  }
  return { cursor }
}

function parseMeasurementsQuery(urlValue: string): ParsedMeasurementsQuery {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    throw invalidQuery()
  }

  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    if (
      (key !== 'userId' && key !== 'cursor') ||
      values.length !== 1 ||
      values[0] === ''
    ) {
      throw invalidQuery()
    }
  }

  const rawUserId = url.searchParams.get('userId')
  const userId = rawUserId === null ? null : parseQueryUserId(rawUserId)
  if (rawUserId !== null && userId === null) {
    throw invalidQuery()
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue === null) {
    return { userId, cursor: null }
  }

  const cursor = parseMeasurementsCursor(cursorValue)
  if (cursor === null) {
    throw invalidQuery()
  }

  if (userId === null && cursor.kind !== 'global') {
    throw invalidQuery()
  }
  if (userId !== null && cursor.kind !== 'selected') {
    throw invalidQuery()
  }
  if (cursor.kind === 'selected' && cursor.userId !== userId) {
    throw invalidQuery()
  }

  return { userId, cursor }
}

function createService(deps: KubiosAdminDeps): KubiosAdminServiceClient {
  try {
    return deps.createService()
  } catch {
    throw unavailable()
  }
}

async function rpcRows(
  service: KubiosAdminServiceClient,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown[]> {
  let response: unknown
  try {
    response = await service.rpc(name, args)
  } catch {
    throw unavailable()
  }

  if (!isRecord(response)) {
    throw unavailable()
  }
  if (response.error !== null && response.error !== undefined) {
    throw unavailable()
  }
  if (!Object.prototype.hasOwnProperty.call(response, 'data')) {
    throw unavailable()
  }

  const data = response.data
  if (!Array.isArray(data)) {
    throw unavailable()
  }
  return data
}

function parseParticipantRows(rows: readonly unknown[]): KubiosAdminParticipant[] {
  const participants: KubiosAdminParticipant[] = []
  let previousUserId = 0

  for (const row of rows) {
    if (!isRecord(row)) {
      throw unavailable()
    }

    const userId = parsePostgresUserId(row.user_id)
    const username = parseUsername(row.username)
    if (userId === null || username === null || userId <= previousUserId) {
      throw unavailable()
    }

    previousUserId = userId
    participants.push({ userId, username })
  }

  return participants
}

function decodeSnapshot(
  row: unknown,
  identity: SnapshotIdentity,
  deps: KubiosAdminDeps,
): Record<string, unknown>[] | null {
  const snapshot = parseKubiosValidatedSnapshotRow(row)
  if (snapshot === null) {
    return null
  }

  let plaintext: string
  try {
    plaintext = deps.decryptSnapshot(
      snapshot.envelope,
      { teamId: identity.teamId, memberId: identity.memberId },
      { env: deps.cryptoEnv },
    )
  } catch (error) {
    if (
      isRecord(error) &&
      (error.code === 'missing_key' ||
        error.code === 'invalid_key' ||
        error.code === 'server_only')
    ) {
      throw unavailable()
    }
    return null
  }

  return parseKubiosSnapshotPayload(plaintext)
}

interface DecoratedResult {
  readonly result: Record<string, unknown>
  readonly index: number
  readonly ms: number | null
}

function sortResults(results: readonly Record<string, unknown>[]): DecoratedResult[] {
  const decorated = results.map((result, index) => ({
    result,
    index,
    ms: readKubiosResultTimestamp(result),
  }))

  decorated.sort((left, right) => {
    if (left.ms !== null && right.ms !== null) {
      if (left.ms !== right.ms) {
        return right.ms - left.ms
      }
      return left.index - right.index
    }
    if (left.ms === null && right.ms === null) {
      return left.index - right.index
    }
    return left.ms === null ? 1 : -1
  })

  return decorated
}

function readMeasuredTimestamp(result: Record<string, unknown>): string | null {
  for (const key of ['measured_timestamp', 'timestamp'] as const) {
    const value = result[key]
    if (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      Number.isFinite(Date.parse(value))
    ) {
      return value
    }
  }
  return null
}

/**
 * El payload real usa la misma forma que la vista personal:
 * `{ measured_timestamp, daily_result, result: { readiness, ... } }`.
 * Solo se leen las métricas visibles dentro de `result`; nunca se devuelve el
 * objeto anidado ni campos crudos como result_id, artefact_level o daily_result.
 */
function extractMetrics(row: Record<string, unknown>): Record<string, number> {
  const result = row.result
  if (!isRecord(result)) {
    return {}
  }

  const metrics: Record<string, number> = {}

  for (const key of TOP_LEVEL_METRIC_KEYS) {
    const value = result[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      metrics[key] = value
    }
  }

  const frequency = result.freq_domain
  if (isRecord(frequency)) {
    for (const key of FREQUENCY_METRIC_KEYS) {
      const value = frequency[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        metrics[key] = value
      }
    }
  }

  return metrics
}

function measurementStatus(
  updatedAtMs: number,
  nowMs: number,
): KubiosAdminMeasurementStatus {
  return nowMs - updatedAtMs <= KUBIOS_SNAPSHOT_STALE_AFTER_MS
    ? 'ready'
    : 'stale'
}

function toMeasurement(
  identity: SnapshotIdentity,
  syncedAt: string,
  status: KubiosAdminMeasurementStatus,
  result: Record<string, unknown>,
): KubiosAdminMeasurement {
  return {
    userId: identity.userId,
    username: identity.username,
    measuredTimestamp: readMeasuredTimestamp(result),
    metrics: extractMetrics(result),
    syncedAt,
    status,
  }
}

function currentTimeMs(deps: KubiosAdminDeps): number {
  const value = deps.now ? deps.now() : new Date()
  const ms = value instanceof Date ? value.getTime() : Number.NaN
  return Number.isFinite(ms) ? ms : Date.now()
}

function encodeParticipantsCursor(participant: KubiosAdminParticipant): string {
  return encodeCursor({
    v: CURSOR_VERSION,
    k: 'p',
    u: participant.userId,
    h: participantAnchorHash(participant),
  })
}

function encodeGlobalCursor(anchor: GlobalAnchor): string | null {
  const anchorHash = snapshotAnchorHash(anchor.identity)
  if (anchorHash === null) {
    return null
  }

  return encodeCursor({
    v: CURSOR_VERSION,
    k: 'g',
    u: anchor.identity.userId,
    i: anchor.nextIndex,
    h: anchorHash,
  })
}

function encodeSelectedCursor(
  identity: SnapshotIdentity,
  nextIndex: number,
): string | null {
  const anchorHash = snapshotAnchorHash(identity)
  if (anchorHash === null) {
    return null
  }

  return encodeCursor({
    v: CURSOR_VERSION,
    k: 'u',
    u: identity.userId,
    i: nextIndex,
    h: anchorHash,
  })
}

async function listGlobalMeasurements(
  cursor: GlobalMeasurementsCursor | null,
  deps: KubiosAdminDeps,
): Promise<KubiosAdminMeasurementsBody> {
  const service = createService(deps)
  const rows = await rpcRows(service, SNAPSHOTS_RPC, {
    p_user_id: null,
    p_start_user_id: cursor === null ? null : cursor.userId,
    p_limit: SNAPSHOT_REQUEST_LIMIT,
  })

  if (cursor !== null) {
    const anchorRow = rows[0]
    if (anchorRow === undefined) {
      throw cursorConflict()
    }

    const anchorIdentity = parseSnapshotIdentity(anchorRow)
    if (
      anchorIdentity === null ||
      anchorIdentity.userId !== cursor.userId ||
      snapshotAnchorHash(anchorIdentity) !== cursor.anchorHash
    ) {
      throw cursorConflict()
    }
  }

  const scanned = rows.slice(0, SNAPSHOT_SCAN_LIMIT)
  const nowMs = currentTimeMs(deps)
  const measurements: KubiosAdminMeasurement[] = []
  let unavailableCount = 0
  let hasReady = false
  let anchor: GlobalAnchor | null = null
  let stoppedAtLimit = false

  scan: for (const [scanIndex, row] of scanned.entries()) {
    const identity = parseSnapshotIdentity(row)
    if (identity === null || identity.updatedAt === null) {
      throw unavailable()
    }

    const results = decodeSnapshot(row, identity, deps)
    if (results === null) {
      unavailableCount += 1
      anchor = { identity, nextIndex: 0 }
      continue
    }

    const sorted = sortResults(results)
    const startIndex = cursor !== null && scanIndex === 0 ? cursor.nextIndex : 0
    if (startIndex > sorted.length) {
      throw invalidQuery()
    }

    const status = measurementStatus(identity.updatedAt.ms, nowMs)
    for (let index = startIndex; index < sorted.length; index += 1) {
      if (measurements.length >= MEASUREMENT_LIMIT) {
        stoppedAtLimit = true
        break scan
      }

      const entry = sorted[index]
      if (entry === undefined) {
        continue
      }

      measurements.push(
        toMeasurement(identity, identity.updatedAt.iso, status, entry.result),
      )
      if (status === 'ready') {
        hasReady = true
      }
      anchor = { identity, nextIndex: index + 1 }
    }

    if (sorted.length <= startIndex) {
      anchor = { identity, nextIndex: sorted.length }
    }
  }

  const hasMore =
    stoppedAtLimit ||
    (scanned.length === SNAPSHOT_SCAN_LIMIT && rows.length > SNAPSHOT_SCAN_LIMIT)
  const nextCursor =
    hasMore && anchor !== null ? encodeGlobalCursor(anchor) : null

  return {
    measurements,
    nextCursor,
    status:
      measurements.length === 0 ? 'empty' : hasReady ? 'ready' : 'stale',
    unavailableCount,
  }
}

async function listSelectedMeasurements(
  userId: number,
  cursor: SelectedMeasurementsCursor | null,
  deps: KubiosAdminDeps,
): Promise<KubiosAdminMeasurementsBody> {
  const service = createService(deps)
  const rows = await rpcRows(service, SNAPSHOTS_RPC, {
    p_user_id: userId,
    p_start_user_id: null,
    p_limit: 1,
  })

  if (rows.length === 0) {
    if (cursor !== null) {
      throw cursorConflict()
    }
    return {
      measurements: [],
      nextCursor: null,
      status: 'unlinked',
      unavailableCount: 0,
    }
  }

  if (rows.length !== 1) {
    throw unavailable()
  }

  const row = rows[0]
  const account = parseSnapshotAccount(row)
  if (account === null || account.userId !== userId) {
    throw unavailable()
  }

  // Un vínculo pendiente no tiene team/member ni sobre; solo user_id y
  // username llegan del vínculo y de public.users.
  if (isPendingSnapshotRow(row)) {
    if (cursor !== null) {
      throw cursorConflict()
    }
    return {
      measurements: [],
      nextCursor: null,
      status: 'pending',
      unavailableCount: 0,
    }
  }

  const identity = parseSnapshotIdentity(row)
  if (identity === null || identity.updatedAt === null) {
    throw unavailable()
  }

  const anchorHash = snapshotAnchorHash(identity)
  if (cursor !== null) {
    if (anchorHash === null || anchorHash !== cursor.anchorHash) {
      throw cursorConflict()
    }
  }

  const results = decodeSnapshot(row, identity, deps)
  if (results === null) {
    throw unavailable()
  }

  const sorted = sortResults(results)
  const startIndex = cursor === null ? 0 : cursor.nextIndex
  if (startIndex >= sorted.length && sorted.length > 0) {
    throw invalidQuery()
  }

  const updatedAt = identity.updatedAt
  const freshness =
    sorted.length === 0
      ? null
      : measurementStatus(updatedAt.ms, currentTimeMs(deps))
  const status: KubiosAdminMeasurementsStatus = freshness ?? 'empty'

  const page = sorted.slice(startIndex, startIndex + MEASUREMENT_LIMIT)
  const measurements =
    freshness === null
      ? []
      : page.map((entry) =>
          toMeasurement(identity, updatedAt.iso, freshness, entry.result),
        )
  const nextIndex = startIndex + page.length
  const nextCursor =
    nextIndex < sorted.length && anchorHash !== null
      ? encodeSelectedCursor(identity, nextIndex)
      : null

  return {
    measurements,
    nextCursor,
    status,
    unavailableCount: 0,
  }
}

/**
 * Lista los participantes activos (con vínculo Kubios) en orden ascendente.
 * El cursor es after exclusivo y se valida también contra el ancla de la
 * página anterior; un cambio de vínculo o username responde 409.
 */
export async function listKubiosAdminParticipants(
  request: KubiosAdminRequestLike,
  deps: KubiosAdminDeps,
): Promise<KubiosAdminParticipantsBody> {
  assertAdminActor(request.actor)
  const query = parseParticipantsQuery(request.url)
  const service = createService(deps)

  if (query.cursor !== null) {
    const verificationRows = await rpcRows(service, PARTICIPANTS_RPC, {
      p_after_user_id:
        query.cursor.afterUserId > 1 ? query.cursor.afterUserId - 1 : null,
      p_limit: 1,
    })
    const verification = parseParticipantRows(verificationRows)
    const anchor = verification[0]
    if (
      anchor === undefined ||
      anchor.userId !== query.cursor.afterUserId ||
      participantAnchorHash(anchor) !== query.cursor.anchorHash
    ) {
      throw cursorConflict()
    }
  }

  const rows = await rpcRows(service, PARTICIPANTS_RPC, {
    p_after_user_id: query.cursor === null ? null : query.cursor.afterUserId,
    p_limit: PARTICIPANTS_LIMIT,
  })
  const participants = parseParticipantRows(rows)
  const last = participants[participants.length - 1]

  return {
    participants,
    nextCursor:
      participants.length === PARTICIPANTS_LIMIT && last !== undefined
        ? encodeParticipantsCursor(last)
        : null,
  }
}

/**
 * Lista mediciones de un usuario seleccionado o de todos los vínculos con
 * snapshot. La query diferencia ambos ámbitos y el cursor queda ligado a uno
 * de ellos; un cursor de otro ámbito es 400.
 */
export async function listKubiosAdminMeasurements(
  request: KubiosAdminRequestLike,
  deps: KubiosAdminDeps,
): Promise<KubiosAdminMeasurementsBody> {
  assertAdminActor(request.actor)
  const query = parseMeasurementsQuery(request.url)

  if (query.userId !== null) {
    const cursor = query.cursor?.kind === 'selected' ? query.cursor : null
    return listSelectedMeasurements(query.userId, cursor, deps)
  }

  const cursor = query.cursor?.kind === 'global' ? query.cursor : null
  return listGlobalMeasurements(cursor, deps)
}
