import type {
  AdminTableDataResponse,
  AdminTableInfo,
  AdminTablesResponse,
  ClientSession,
  DecryptedDataQuery,
  DecryptedDataResponse,
  LoginInput,
  SessionUser,
  User,
  UserCreateInput,
  UserListQuery,
  UserUpdateInput,
} from './api-types'
import { mapUserDto, toDashboardUser } from './user-mapper'

type UnknownRecord = Record<string, unknown>

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function contractError(message: string): never {
  throw new ApiError(0, 'CONTRACT_ERROR', message)
}

export function buildQuery(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query.length > 0 ? `?${query}` : ''
}

function problemMessage(body: unknown, status: number): { code: string; message: string; details?: unknown } {
  if (isRecord(body) && isRecord(body.error)) {
    const code = asString(body.error.code) ?? `HTTP_${status}`
    const message =
      asString(body.error.message) ??
      `La operación falló con el estado ${status}`
    return { code, message, details: body.error.details }
  }
  if (isRecord(body) && typeof body.error === 'string' && body.error.length > 0) {
    return { code: `HTTP_${status}`, message: body.error }
  }
  if (typeof body === 'string' && body.trim().length > 0) {
    return { code: `HTTP_${status}`, message: body.trim() }
  }
  return {
    code: `HTTP_${status}`,
    message: `La operación falló con el estado ${status}`,
  }
}

/**
 * Same-origin JSON client. Session cookies are HttpOnly and are sent
 * automatically by the browser; no token is ever read or stored in JS.
 */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    )
  }

  const text = response.status === 204 ? '' : await response.text()
  let body: unknown = undefined
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth:unauthorized'))
    }
    const problem = problemMessage(body, response.status)
    throw new ApiError(response.status, problem.code, problem.message, problem.details)
  }

  if (response.status === 204) return undefined as T
  return body as T
}

function mapClientSession(raw: unknown, fallbackMethod: 'email' | 'username'): ClientSession {
  if (!isRecord(raw)) contractError('La respuesta de sesión no es válida')
  if (!isRecord(raw.user)) contractError('La respuesta de sesión no incluye el usuario')

  const user: SessionUser = mapUserDto(raw.user)
  const methodValue = asString(raw.method) ?? asString(raw.authMethod)
  const method = methodValue === 'username' || methodValue === 'email' ? methodValue : fallbackMethod

  return {
    user,
    method,
    expiresAt: asString(raw.expiresAt) ?? '',
  }
}

function mapUserResponse(raw: unknown): User {
  const record = isRecord(raw) ? raw : {}
  const rawUser = isRecord(record.user) ? record.user : raw
  const user = mapUserDto(rawUser)
  if (user.id.length === 0) contractError('La respuesta de usuario no incluye un identificador')
  return toDashboardUser(user)
}

function mapUserList(raw: unknown): { users: User[]; total: number } {
  if (!isRecord(raw) || !Array.isArray(raw.users)) {
    contractError('La respuesta de usuarios no incluye el arreglo users')
  }
  const total = asNumber(raw.total)
  if (total === null) contractError('La respuesta de usuarios no incluye el total')
  return {
    users: raw.users.map((entry) => toDashboardUser(entry)),
    total,
  }
}

function mapDecryptedData(raw: unknown): DecryptedDataResponse {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.insulinData) ||
    !Array.isArray(raw.foodData) ||
    !Array.isArray(raw.exerciseData) ||
    !Array.isArray(raw.periodData) ||
    !Array.isArray(raw.moodData)
  ) {
    contractError('La respuesta de datos no incluye las cinco colecciones esperadas')
  }
  return {
    insulinData: raw.insulinData as DecryptedDataResponse['insulinData'],
    foodData: raw.foodData as DecryptedDataResponse['foodData'],
    exerciseData: raw.exerciseData as DecryptedDataResponse['exerciseData'],
    periodData: raw.periodData as DecryptedDataResponse['periodData'],
    moodData: raw.moodData as DecryptedDataResponse['moodData'],
  }
}

function mapTables(raw: unknown): AdminTablesResponse {
  if (!isRecord(raw) || !Array.isArray(raw.tables)) {
    contractError('La respuesta de tablas no es válida')
  }
  if (raw.success === false) {
    const problem = problemMessage(raw, 200)
    throw new ApiError(200, problem.code, problem.message, problem.details)
  }
  const tables: AdminTableInfo[] = raw.tables.map((entry) => {
    if (!isRecord(entry)) contractError('La respuesta de tablas contiene una entrada inválida')
    return {
      name: asString(entry.name) ?? '',
      recordCount: asNumber(entry.recordCount) ?? 0,
      accessible: entry.accessible === true,
      ...(asString(entry.error) === null ? {} : { error: asString(entry.error) ?? undefined }),
    }
  })
  return {
    success: true,
    tables,
    totalRecords: asNumber(raw.totalRecords) ?? 0,
    accessibleCount: asNumber(raw.accessibleCount) ?? 0,
    totalCount: asNumber(raw.totalCount) ?? tables.length,
  }
}

export const authApi = {
  async login(input: LoginInput): Promise<ClientSession> {
    const fallbackMethod = 'email' in input ? 'email' : 'username'
    const raw = await apiRequest<unknown>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return mapClientSession(raw, fallbackMethod)
  },

  async session(): Promise<ClientSession> {
    const raw = await apiRequest<unknown>('/api/auth/session')
    // The final contract always includes `method`. The email fallback keeps the
    // UI usable against older deployments while the backend is being updated.
    return mapClientSession(raw, 'email')
  },

  async logout(): Promise<void> {
    await apiRequest<void>('/api/auth/logout', { method: 'POST' })
  },
}

export const usersApi = {
  async list(query: UserListQuery = {}): Promise<{ users: User[]; total: number }> {
    const raw = await apiRequest<unknown>(
      `/api/users${buildQuery({
        search: query.search,
        role: query.role,
        limit: query.limit,
        offset: query.offset,
      })}`,
    )
    return mapUserList(raw)
  },

  /**
   * Walks every page so callers never silently receive a truncated list. The
   * backend caps `limit` at 100.
   */
  async listAll(query: Omit<UserListQuery, 'limit' | 'offset'> = {}): Promise<{ users: User[]; total: number }> {
    const pageSize = 100
    const collected: User[] = []
    let total = 0

    for (let page = 0; page < 1000; page += 1) {
      const response = await usersApi.list({
        ...query,
        limit: pageSize,
        offset: collected.length,
      })
      total = response.total
      collected.push(...response.users)
      if (collected.length >= total) break
      if (response.users.length === 0) {
        throw new ApiError(
          0,
          'INCOMPLETE_LIST',
          'El servidor devolvió una página vacía antes de completar la lista de usuarios',
        )
      }
    }

    if (collected.length < total) {
      throw new ApiError(
        0,
        'INCOMPLETE_LIST',
        'No se pudo cargar la lista completa de usuarios',
      )
    }

    const unique = new Map(collected.map((user) => [user.UserID, user]))
    const users = Array.from(unique.values())
    return { users, total }
  },

  async create(input: UserCreateInput): Promise<User> {
    const raw = await apiRequest<unknown>('/api/users', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return mapUserResponse(raw)
  },

  async update(id: string, input: UserUpdateInput): Promise<User> {
    const raw = await apiRequest<unknown>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return mapUserResponse(raw)
  },

  async clearUuid(id: string): Promise<User> {
    const raw = await apiRequest<unknown>(
      `/api/users/${encodeURIComponent(id)}/uuid`,
      { method: 'DELETE' },
    )
    return mapUserResponse(raw)
  },

  async remove(id: string): Promise<void> {
    await apiRequest<void>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async count(): Promise<number> {
    const raw = await apiRequest<unknown>('/api/users/count')
    const count = isRecord(raw) ? asNumber(raw.count) : null
    if (count === null) {
      contractError('La respuesta de conteo no incluye count')
    }
    return count
  },
}

export const dataApi = {
  async getDecrypted(
    query: DecryptedDataQuery = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<DecryptedDataResponse> {
    const raw = await apiRequest<unknown>(
      `/api/decrypted-data${buildQuery({
        selectedUser: query.selectedUser,
        timeRange: query.timeRange,
        selectedDataType: query.selectedDataType,
        dateFilter: query.dateFilter,
      })}`,
      { signal: options.signal },
    )
    return mapDecryptedData(raw)
  },
}

export const adminApi = {
  async listTables(): Promise<AdminTablesResponse> {
    const raw = await apiRequest<unknown>('/api/admin/database/tables')
    return mapTables(raw)
  },

  async getTableData(table: string, limit = 100): Promise<AdminTableDataResponse> {
    const raw = await apiRequest<unknown>(
      `/api/admin/database/table-data${buildQuery({ table, limit })}`,
    )
    if (!isRecord(raw) || !Array.isArray(raw.data)) {
      contractError('La respuesta de la tabla no incluye el arreglo data')
    }
    return {
      success: true,
      tableName: asString(raw.tableName) ?? table,
      data: raw.data as Record<string, unknown>[],
      totalRecords: asNumber(raw.totalRecords) ?? 0,
      returnedRecords: asNumber(raw.returnedRecords) ?? raw.data.length,
      limit: asNumber(raw.limit) ?? limit,
    }
  },
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'Ha ocurrido un error inesperado'
}

export function errorFrom(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(errorMessage(error))
}
