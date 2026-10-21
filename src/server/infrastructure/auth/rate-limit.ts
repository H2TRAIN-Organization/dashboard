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
