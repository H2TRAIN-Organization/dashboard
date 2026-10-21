import type { UserDataPresence } from "@/server/application/ports/user-repository";
import type { User } from "@/server/domain/user";

/** Test-only adapter. */
export class InMemoryUserDataPresence implements UserDataPresence {
  private readonly userIdsWithData: Set<string>;

  constructor(userIdsWithData: Iterable<string> = []) {
    this.userIdsWithData = new Set(userIdsWithData);
  }

  async hasAnyForUser(user: User): Promise<boolean> {
    return this.userIdsWithData.has(user.id);
  }

  markAsHavingData(userId: string): void {
    this.userIdsWithData.add(userId);
  }
}
