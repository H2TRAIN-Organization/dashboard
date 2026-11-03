import { createHash } from "node:crypto";
import type { AuthMethod } from "./contracts";

/**
 * The limiter stores only this digest. It is bound to the auth method so the
 * same email/username text cannot collide across flows.
 */
export function createLoginRateLimitKey(
  method: AuthMethod,
  identifier: string,
): string {
  return createHash("sha256")
    .update(`dashboard-auth:v1:${method}:${identifier.trim().toLowerCase()}`, "utf8")
    .digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim();
}

/**
 * Conservatively normalizes an identity for an exact comparison: trim,
 * Unicode NFC and lower case. It is used only to decide whether a confirmed
 * Supabase email matches exactly one legacy Username; the persisted Username
 * and the role always come from public.users.
 */
export function normalizeIdentity(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}
