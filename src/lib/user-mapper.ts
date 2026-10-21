import type { AppUser, SessionUser, User, UserRole } from './api-types'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstDefined(record: UnknownRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key]
    }
  }
  return undefined
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function asNullableString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

export function normalizeRole(value: unknown): UserRole {
  if (value === 'admin' || value === 'doctor' || value === 'user') return value
  return 'user'
}

/**
 * Maps both the canonical DTO (`id`, `username`, `uuid`, `gdprConsent`) and the
 * legacy shapes (`UserID`, `Username`, `UUID`, `GDPRConsent`) into the canonical
 * public user. It deliberately picks individual fields so a hash or any other
 * accidental column can never reach the browser.
 */
export function mapUserDto(raw: unknown): SessionUser {
  if (!isRecord(raw)) {
    return {
      id: '',
      username: '',
      email: null,
      role: 'user',
      uuid: null,
      gdprConsent: false,
      gdprConsentAt: null,
      createdAt: null,
    }
  }

  return {
    id: asString(firstDefined(raw, ['id', 'userId', 'UserID'])),
    username: asString(firstDefined(raw, ['username', 'Username', 'name'])),
    email: asNullableString(firstDefined(raw, ['email', 'Email'])),
    role: normalizeRole(firstDefined(raw, ['role', 'Role'])),
    uuid: asNullableString(firstDefined(raw, ['uuid', 'UUID'])),
    gdprConsent: asBoolean(firstDefined(raw, ['gdprConsent', 'GDPRConsent'])),
    gdprConsentAt: asNullableString(
      firstDefined(raw, ['gdprConsentAt', 'GDPRConsentDate', 'GDPRConsentAt']),
    ),
    createdAt: asNullableString(firstDefined(raw, ['createdAt', 'CreatedAt'])),
  }
}

export function toDashboardUser(raw: unknown): User {
  const user = mapUserDto(raw)
  return {
    UserID: user.id,
    Username: user.username,
    Email: user.email,
    UUID: user.uuid,
    GDPRConsent: user.gdprConsent,
    GDPRConsentDate: user.gdprConsentAt,
    role: user.role,
    createdAt: user.createdAt,
  }
}

export function toAppUser(user: SessionUser): AppUser {
  return {
    UserID: user.id,
    Username: user.username,
    Email: user.email,
    UUID: user.uuid,
    GDPRConsent: user.gdprConsent,
    GDPRConsentDate: user.gdprConsentAt,
    role: user.role,
  }
}

export function getDisplayUsername(
  user: { Username?: string | null; username?: string | null } | null | undefined,
): string {
  if (!user) return 'Usuario sin nombre'
  const value =
    typeof user.Username === 'string'
      ? user.Username
      : typeof user.username === 'string'
        ? user.username
        : ''
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : 'Usuario sin nombre'
}
