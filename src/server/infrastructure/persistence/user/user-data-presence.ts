import type { UserDataPresence } from "@/server/application/ports/user-repository";
import type { User } from "@/server/domain/user";

import { parseUserId } from "../ids";
import type { PersistenceGateway } from "../supabase/query-types";

/**
 * Transactional presence check backed by the T-009 SQL function. It is only an
 * advisory pre-check for the use case; the delete RPC repeats the check under
 * table locks and foreign keys.
 */
export class SupabaseUserDataPresence implements UserDataPresence {
  constructor(private readonly gateway: PersistenceGateway) {}

  async hasAnyForUser(user: User): Promise<boolean> {
    const userId = parseUserId(user.id);
    if (userId === null) {
      return false;
    }
    const result = await this.gateway.rpc<boolean>("t009_user_has_health_data", {
      p_user_id: userId,
    });
    return result === true;
  }
}
