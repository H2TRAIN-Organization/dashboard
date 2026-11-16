/**
 * Resolution of health-record keys.
 *
 * Health tables key rows by a free-form `username` column. The canonical value
 * is `users.Username`, but external producers (the mobile app) also write rows
 * keyed by the alias `auth_<supabase-uid>` of a verified Supabase Auth identity
 * linked to the same account. The dashboard must read both formats without ever
 * trusting client input: the resolver is a server-side security boundary.
 */
export interface RecordKeyQuery {
  /** Canonical `users.Username` of the account. */
  readonly username: string;
  /**
   * Canonical decimal string of `users.UserID`, when the caller already knows
   * it. It enables the administered `app_metadata.app_user_id` match without
   * an extra lookup.
   */
  readonly userId?: string;
}

export interface HealthRecordKeyResolver {
  /**
   * Returns every record key owned by the account, canonical username first.
   * Must fail closed: on infrastructure failure it throws instead of
   * returning a partial set that would silently hide rows.
   */
  resolve(query: RecordKeyQuery): Promise<readonly string[]>;

  /**
   * Maps every known record key (canonical username and alias) to the
   * canonical `users.Username` of the owning account. Record keys absent from
   * the map keep their own value. Implementations may return an empty map
   * when no identity link is known.
   */
  ownershipByRecordKey(): Promise<ReadonlyMap<string, string>>;
}

/**
 * Default resolver used when no identity resolution is wired. It returns only
 * the canonical username, which is exactly the pre-alias behavior and never
 * widens access.
 */
export function createCanonicalRecordKeyResolver(): HealthRecordKeyResolver {
  return {
    async resolve(query: RecordKeyQuery): Promise<readonly string[]> {
      return [query.username];
    },
    async ownershipByRecordKey(): Promise<ReadonlyMap<string, string>> {
      return new Map();
    },
  };
}
