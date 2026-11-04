import 'server-only'

import { z } from 'zod'
import { decryptKubiosSnapshot } from '@/lib/kubios-crypto'
import { handleKubiosHrvResultsRequest, type KubiosMeDeps } from '@/lib/kubios-snapshot-reader'
import { utcTimestamp } from '@/lib/study-normalization'
import type { AdminKubiosMeasurement, AdminKubiosParticipant, AdminKubiosPage } from '@/lib/admin-kubios-contract'
import { ForbiddenError, NotFoundError, ServiceUnavailableError, UnauthorizedError, ValidationError } from '@/server/domain/errors'
import { assertPrivacyAcknowledged } from '@/server/domain/privacy'
import { toActiveActor } from '@/server/domain/session'
import type { ActiveActor } from '@/server/domain/user'
import { getServerRuntime } from './runtime'
import { createKubiosRpcClient } from './kubios-runtime'

const linkSchema = z.strictObject({ user_id: z.number().int().positive(), username: z.string().min(1).max(100), team_id: z.uuid(), kubios_member_id: z.uuid() })
export interface AdminKubiosDeps {
  createService: KubiosMeDeps['createService']
  decryptSnapshot: KubiosMeDeps['decryptSnapshot']
  cryptoEnv: KubiosMeDeps['cryptoEnv']
  now?: () => Date
}
const defaults: AdminKubiosDeps = { createService: createKubiosRpcClient, decryptSnapshot: decryptKubiosSnapshot, cryptoEnv: process.env }
const numericFields = ['readiness', 'mean_hr_bpm', 'rmssd_ms', 'pns_index', 'sns_index', 'physiological_age', 'respiratory_rate', 'stress_index'] as const

/** Allowlist only: provider identifiers and arbitrary nested keys never cross this boundary. */
export function sanitizeAdminMeasurement(row: Record<string, unknown>): AdminKubiosMeasurement {
  const time = row.measured_timestamp ?? row.timestamp
  const timestamp = utcTimestamp(time)
  const measured_timestamp = timestamp === null ? null : new Date(timestamp).toISOString()
  const raw = typeof row.result === 'object' && row.result !== null ? row.result as Record<string, unknown> : {}
  const result: Record<string, number | string | null | Record<string, number>> = {}
  for (const key of numericFields) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) result[key] = raw[key] as number
  }
  if (typeof raw.artefact_level === 'string' && raw.artefact_level.length <= 64) result.artefact_level = raw.artefact_level
  if (typeof raw.freq_domain === 'object' && raw.freq_domain !== null) {
    const freq = raw.freq_domain as Record<string, unknown>
    const clean: Record<string, number> = {}
    for (const key of ['HF_power', 'LF_power', 'VLF_power', 'tot_power']) {
      if (typeof freq[key] === 'number' && Number.isFinite(freq[key])) clean[key] = freq[key] as number
    }
    result.freq_domain = clean
  }
  return { measured_timestamp, daily_result: typeof row.daily_result === 'string' && row.daily_result.length <= 128 ? row.daily_result : null, result }
}

export async function requireAdminKubios(token: string | undefined): Promise<ActiveActor> {
  if (!token) throw new UnauthorizedError()
  const session = await (await getServerRuntime()).useCases.auth.getSession(token)
  if (!session) throw new UnauthorizedError()
  assertPrivacyAcknowledged(session)
  const actor = toActiveActor(session)
  assertAdmin(actor)
  return actor
}
function assertAdmin(actor: ActiveActor): void {
  if (actor.role !== 'admin') throw new ForbiddenError()
}

function adminService(deps: AdminKubiosDeps) {
  try { return deps.createService() }
  catch { throw new ServiceUnavailableError('Kubios no disponible') }
}
async function loadAdminParticipant(link: z.infer<typeof linkSchema>, deps: AdminKubiosDeps, service: ReturnType<AdminKubiosDeps['createService']>): Promise<AdminKubiosParticipant> {
  const result = await handleKubiosHrvResultsRequest({ sessionToken: 'verified-admin', url: 'https://internal.invalid/' }, {
    ...deps, createService: () => service,
    resolveIdentity: async () => ({ status: 'linked', teamId: link.team_id, memberId: link.kubios_member_id }),
  })
  if (result.status !== 200 || !('results' in result.body) || result.body.status === 'unlinked') throw new ServiceUnavailableError('Kubios no disponible')
  return { username: link.username, userId: link.user_id, status: result.body.status, syncedAt: result.body.synced_at,
    measurementCount: result.body.results.length, results: result.body.results.map(sanitizeAdminMeasurement) }
}

/** Complete keyset traversal. Any malformed row, duplicate or read/decrypt error aborts the export. */
export async function readAllAdminKubios(actor: ActiveActor, deps: AdminKubiosDeps = defaults): Promise<readonly AdminKubiosParticipant[]> {
  assertAdmin(actor)
  const service = adminService(deps)
  const participants: AdminKubiosParticipant[] = []
  let after = 0
  while (true) {
    let response: unknown
    try { response = await service.rpc('kubios_admin_list_links', { p_after_user_id: after, p_limit: 100 }) }
    catch { throw new ServiceUnavailableError('Kubios no disponible') }
    const envelope = z.object({ data: z.array(linkSchema).max(100), error: z.null().optional() }).safeParse(response)
    if (!envelope.success) throw new ServiceUnavailableError('Kubios no disponible')
    for (const link of envelope.data.data) {
      if (link.user_id <= after) throw new ServiceUnavailableError('Listado Kubios incompleto')
      after = link.user_id
      participants.push(await loadAdminParticipant(link, deps, service))
    }
    if (envelope.data.data.length === 0) return participants
    if (participants.length >= 100000) throw new ServiceUnavailableError('Listado Kubios excede el limite de lectura')
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v)
export const adminKubiosQuerySchema = z.strictObject({
  search: z.string().trim().max(40).default(''), from: day.optional(), to: day.optional(),
  status: z.enum(['all', 'pending', 'empty', 'ready', 'stale']).default('all'),
  page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).refine(v => !v.from || !v.to || v.from <= v.to)
export const adminKubiosDateQuerySchema = z.strictObject({ from: day.optional(), to: day.optional() }).refine(v => !v.from || !v.to || v.from <= v.to)
export type AdminKubiosQuery = z.infer<typeof adminKubiosQuerySchema>
export function filterAdminParticipant(participant: AdminKubiosParticipant, query: Pick<AdminKubiosQuery, 'from' | 'to'>): AdminKubiosParticipant {
  const results = participant.results.filter(row => {
    if (!query.from && !query.to) return true
    if (!row.measured_timestamp) return false
    const date = row.measured_timestamp.slice(0, 10)
    return (!query.from || date >= query.from) && (!query.to || date <= query.to)
  })
  return { ...participant, results, measurementCount: results.length }
}
export async function listAdminKubios(actor: ActiveActor, query: AdminKubiosQuery, deps: AdminKubiosDeps = defaults): Promise<AdminKubiosPage> {
  assertAdmin(actor)
  const summary = (p: AdminKubiosParticipant) => ({ userId: p.userId, username: p.username, status: p.status, syncedAt: p.syncedAt, measurementCount: p.measurementCount })
  // Status/date filters inspect encrypted measurement contents; their exact totals require a complete cache read.
  if (query.status !== 'all' || query.from || query.to) {
    const rows = (await readAllAdminKubios(actor, deps)).filter(p => (String(p.userId).includes(query.search) || p.username.toLowerCase().includes(query.search.toLowerCase())) && (query.status === 'all' || query.status === p.status))
      .map(p => filterAdminParticipant(p, query)).filter(p => (!query.from && !query.to) || p.measurementCount > 0)
    return { participants: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map(summary), page: query.page, pageSize: query.pageSize, total: rows.length }
  }
  const service = adminService(deps)
  let response: unknown
  try { response = await service.rpc('kubios_admin_page_links', { p_search: query.search, p_offset: (query.page - 1) * query.pageSize, p_limit: query.pageSize }) }
  catch { throw new ServiceUnavailableError('Kubios no disponible') }
  const parsed = z.object({ data: z.object({ links: z.array(linkSchema).max(100), total: z.number().int().nonnegative() }), error: z.null().optional() }).safeParse(response)
  if (!parsed.success) throw new ServiceUnavailableError('Kubios no disponible')
  const { links, total } = parsed.data.data
  const expected = Math.min(query.pageSize, Math.max(0, total - (query.page - 1) * query.pageSize))
  if (links.length !== expected || links.some((link, i) => i > 0 && link.user_id <= links[i-1]!.user_id)) throw new ServiceUnavailableError('Listado Kubios incompleto')
  const participants = []
  for (const link of links) participants.push(summary(await loadAdminParticipant(link, deps, service)))
  return { participants, page: query.page, pageSize: query.pageSize, total }
}
export async function getAdminKubios(actor: ActiveActor, userId: string, query: Pick<AdminKubiosQuery, 'from' | 'to'>, deps: AdminKubiosDeps = defaults): Promise<AdminKubiosParticipant> {
  assertAdmin(actor)
  if (!/^[1-9]\d*$/.test(userId) || !Number.isSafeInteger(Number(userId)) || Number(userId) > 2147483647) throw new ValidationError()
  const service = adminService(deps)
  let response: unknown
  try { response = await service.rpc('kubios_admin_get_link', { p_user_id: Number(userId) }) }
  catch { throw new ServiceUnavailableError('Kubios no disponible') }
  const parsed = z.object({ data: z.array(linkSchema).max(1), error: z.null().optional() }).safeParse(response)
  if (!parsed.success) throw new ServiceUnavailableError('Vinculo Kubios no valido')
  const link = parsed.data.data[0]
  if (!link) throw new NotFoundError()
  if (link.user_id !== Number(userId)) throw new ServiceUnavailableError('Vinculo Kubios no valido')
  return filterAdminParticipant(await loadAdminParticipant(link, deps, service), query)
}
