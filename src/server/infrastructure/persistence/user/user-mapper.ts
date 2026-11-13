import { isUserRole, type User, type UserRole } from "@/server/domain/user";

import {
  asBoolean,
  asRecord,
  normalizeTimestamp,
  nullableString,
  requireString,
  toCanonicalUserId,
} from "../ids";

/**
 * Explicit public projection. `PasswordHash` is never part of this list.
 */
export const USER_PUBLIC_COLUMNS =
  'UserID,Username,UUID,GDPRConsent,GDPRConsentDate,role' as const;

/**
 * Safe projection for the admin table viewer. It also excludes PasswordHash.
 */
export const USER_ADMIN_COLUMNS =
  'UserID,Username,UUID,GDPRConsent,GDPRConsentDate,sexo,bomba_insulina,role' as const;

export function normalizeRole(value: unknown): UserRole {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (isUserRole(normalized)) {
      return normalized;
    }
  }
  // Least privilege: unknown or missing role is treated as a regular user.
  return "user";
}

export function mapUserRow(value: unknown): User {
  const row = asRecord(value, "users");
  const id = toCanonicalUserId(row.UserID);
  // Cutover MT48: la columna legacy "Username" desaparece del select; una fila
  // sin la clave se considera "pendiente de descifrar" (string vacío) y el
  // repositorio la completa con UsernameVault. Un Username null sigue siendo
  // datos corruptos y falla cerrado.
  const username =
    row.Username === undefined
      ? ""
      : requireString(row.Username, "Username", "users");
  const gdprConsent = asBoolean(row.GDPRConsent);
  const uuid = nullableString(row.UUID, "UUID", "users");
  const gdprConsentAt = gdprConsent
    ? normalizeTimestamp(row.GDPRConsentDate)
    : null;

  return {
    id,
    username,
    // public.users has no Email column in the verified schema.
    email: null,
    role: normalizeRole(row.role),
    uuid,
    gdprConsent,
    gdprConsentAt,
    // public.users has no CreatedAt column in the verified schema.
    createdAt: null,
  };
}

/**
 * Raw-but-safe user row for the admin table viewer. No hash or credential
 * material is copied.
 */
export function mapUserAdminRow(value: unknown): Record<string, unknown> {
  const row = asRecord(value, "users");
  return {
    UserID: row.UserID,
    // Cutover MT48: la columna legacy puede no estar en el select; el
    // repositorio admin completa el username cifrado vía UsernameVault.
    Username: row.Username === undefined ? undefined : row.Username,
    UUID: row.UUID ?? null,
    GDPRConsent: asBoolean(row.GDPRConsent),
    GDPRConsentDate: normalizeTimestamp(row.GDPRConsentDate),
    sexo: row.sexo ?? null,
    bomba_insulina: asBoolean(row.bomba_insulina),
    role: normalizeRole(row.role),
  };
}
