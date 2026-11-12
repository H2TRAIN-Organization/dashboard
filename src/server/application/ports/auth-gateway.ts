import type { Session } from "@/server/domain/session";
import type { PrivacyDecision, PrivacyDecisionResult } from '@/server/domain/privacy';

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
  decidePrivacy?(token: string, decision: PrivacyDecision): Promise<PrivacyDecisionResult>;
  authenticateByEmail(email: string, password: string): Promise<Session | null>;
  authenticateByUsername(username: string, password: string): Promise<Session | null>;
  /**
   * True when a legacy `public.users.Username` exists for this exact value.
   * Used to let an email-shaped legacy account log in without probing the
   * legacy verifier on every ordinary email login.
   */
  hasLegacyUsername(username: string): Promise<boolean>;
  getSession(token: string): Promise<Session | null>;
  revokeSession(token: string): Promise<void>;
}
