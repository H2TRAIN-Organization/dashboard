import type { Session } from "@/server/domain/session";

export interface LoginCredentials {
  readonly email?: string;
  readonly username?: string;
  readonly password: string;
}

/**
 * Authentication is intentionally a port. The production adapter must verify
 * the existing legacy credential format before it can be implemented; no schema or
 * hash format is assumed by this foundation.
 */
export interface AuthGateway {
  authenticateByEmail(email: string, password: string): Promise<Session | null>;
  authenticateByUsername(username: string, password: string): Promise<Session | null>;
  getSession(token: string): Promise<Session | null>;
  revokeSession(token: string): Promise<void>;
}
