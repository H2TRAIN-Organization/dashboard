import { describe, expect, it } from "vitest";

import { createAuthUseCases } from "@/server/application/auth/auth-use-cases";
import { createUserUseCases } from "@/server/application/users/user-use-cases";
import { createUsersHttpHandlers } from "@/server/http/handlers/users";
import { InMemoryUserDataPresence } from "@/server/infrastructure/testing/in-memory-user-data-presence";
import { InMemoryUserRepository } from "@/server/infrastructure/testing/in-memory-user-repository";
import { TestAuthGateway, type TestAccount } from "@/server/infrastructure/testing/test-auth-gateway";
import type { User } from "@/server/domain/user";
import { makeUser } from "../helpers/fixtures";

const EXPIRES_AT = "2026-12-31T23:59:59.000Z";

function buildUsers(): User[] {
  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    return makeUser({
      id: String(number),
      username: `member-${String(number).padStart(2, "0")}`,
      role: index % 3 === 0 ? "user" : index % 3 === 1 ? "doctor" : "admin",
    });
  });
}

function setup() {
  const users = buildUsers();
  const admin = users[2];
  const regular = users[3];
  if (admin === undefined || regular === undefined) {
    throw new Error("fixture incompleto");
  }

  const accounts: TestAccount[] = [
    {
      user: admin,
      password: "admin-secret",
      token: "admin-token",
      method: "username",
      expiresAt: EXPIRES_AT,
    },
    {
      user: regular,
      password: "user-secret",
      token: "user-token",
      method: "username",
      expiresAt: EXPIRES_AT,
    },
  ];

  const handlers = createUsersHttpHandlers(
    createAuthUseCases(new TestAuthGateway(accounts)),
    createUserUseCases(
      new InMemoryUserRepository(users),
      new InMemoryUserDataPresence(),
    ),
  );

  return { handlers, users };
}

function bodyOf(result: { body?: unknown }): Record<string, unknown> {
  return result.body as Record<string, unknown>;
}

function usernamesOf(result: { body?: unknown }): string[] {
  return (bodyOf(result).users as Array<{ username: string }>).map(
    (user) => user.username,
  );
}

describe("GET /api/users page/pageSize contract", () => {
  it("paginates after filtering and reports the filtered total", async () => {
    const { handlers } = setup();

    const first = await handlers.list({
      sessionToken: "admin-token",
      query: { page: "1", pageSize: "10" },
    });
    expect(first.status).toBe(200);
    expect(bodyOf(first).total).toBe(12);
    expect(usernamesOf(first)).toHaveLength(10);

    const second = await handlers.list({
      sessionToken: "admin-token",
      query: { page: "2", pageSize: "10" },
    });
    expect(second.status).toBe(200);
    expect(bodyOf(second).total).toBe(12);
    expect(usernamesOf(second)).toEqual(["member-11", "member-12"]);

    const beyond = await handlers.list({
      sessionToken: "admin-token",
      query: { page: "3", pageSize: "10" },
    });
    expect(beyond.status).toBe(200);
    expect(bodyOf(beyond).total).toBe(12);
    expect(usernamesOf(beyond)).toEqual([]);
  });

  it("applies search and role before pagination", async () => {
    const { handlers } = setup();

    const search = await handlers.list({
      sessionToken: "admin-token",
      query: { search: "member-1", page: "1", pageSize: "10" },
    });
    expect(search.status).toBe(200);
    expect(bodyOf(search).total).toBe(3);
    expect(usernamesOf(search)).toEqual(["member-10", "member-11", "member-12"]);

    const filtered = await handlers.list({
      sessionToken: "admin-token",
      query: { search: "member-1", role: "user", limit: "2", offset: "0" },
    });
    expect(filtered.status).toBe(200);
    expect(bodyOf(filtered).total).toBe(1);
    expect(usernamesOf(filtered)).toEqual(["member-10"]);
  });

  it("defaults to pageSize 25 and still accepts the legacy limit/offset pair", async () => {
    const { handlers } = setup();

    const defaults = await handlers.list({
      sessionToken: "admin-token",
      query: {},
    });
    expect(defaults.status).toBe(200);
    expect(bodyOf(defaults).total).toBe(12);
    expect(usernamesOf(defaults)).toHaveLength(12);

    const legacy = await handlers.list({
      sessionToken: "admin-token",
      query: { limit: "100", offset: "10" },
    });
    expect(legacy.status).toBe(200);
    expect(bodyOf(legacy).total).toBe(12);
    expect(usernamesOf(legacy)).toEqual(["member-11", "member-12"]);
  });

  it("rejects ambiguous pagination and unsupported page sizes", async () => {
    const { handlers } = setup();

    const mixed = await handlers.list({
      sessionToken: "admin-token",
      query: { page: "2", pageSize: "10", offset: "10" },
    });
    expect(mixed.status).toBe(400);

    const invalidSize = await handlers.list({
      sessionToken: "admin-token",
      query: { page: "1", pageSize: "7" },
    });
    expect(invalidSize.status).toBe(400);

    const zeroPage = await handlers.list({
      sessionToken: "admin-token",
      query: { page: "0", pageSize: "10" },
    });
    expect(zeroPage.status).toBe(400);
  });

  it("keeps a regular user limited to self while reporting the filtered total", async () => {
    const { handlers } = setup();

    const first = await handlers.list({
      sessionToken: "user-token",
      query: { page: "1", pageSize: "10" },
    });
    expect(first.status).toBe(200);
    expect(bodyOf(first).total).toBe(1);
    expect(usernamesOf(first)).toEqual(["member-04"]);

    const second = await handlers.list({
      sessionToken: "user-token",
      query: { page: "2", pageSize: "10" },
    });
    expect(second.status).toBe(200);
    expect(bodyOf(second).total).toBe(1);
    expect(usernamesOf(second)).toEqual([]);
  });
});
