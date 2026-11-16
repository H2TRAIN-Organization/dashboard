import { describe, expect, it } from "vitest";

import {
  SupabaseHealthRecordKeyResolver,
  type HealthRecordKeyResolverOptions,
} from "@/server/infrastructure/auth/health-record-key-resolver";

import { FakePersistenceGateway } from "../persistence/helpers/fake-gateway";

interface FakeAuthRow {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown>;
}

type ListUsersHandler = (options: {
  page?: number;
  perPage?: number;
}) => Promise<{
  data: { users: FakeAuthRow[] } | null;
  error: unknown;
}>;

function fakeClient(handler: ListUsersHandler) {
  return {
    auth: { admin: { listUsers: handler } },
  };
}

function row(options: FakeAuthRow): FakeAuthRow {
  return options;
}

const JAVIER_AUTH_UID = "d16ebc46-1c2f-4a9e-b5e1-4b2fa997cf99";
const JAVIER_AUTH_ROW = row({
  id: JAVIER_AUTH_UID,
  email: "javier.alayon@ulpgc.es",
  email_confirmed_at: "2026-10-29T11:27:42.000Z",
  app_metadata: { app_user_id: 8, role: "user" },
});

function resolverOptions(
  authRows: FakeAuthRow[],
  extra: Partial<HealthRecordKeyResolverOptions> = {},
  handler?: ListUsersHandler,
): HealthRecordKeyResolverOptions {
  const defaultHandler: ListUsersHandler = async () => ({
    data: { users: authRows },
    error: null,
  });
  return {
    client: fakeClient(handler ?? defaultHandler),
    users: new FakePersistenceGateway({
      users: [
        { UserID: 8, Username: "javier.alayon@ulpgc.es", role: "user" },
        { UserID: 67, Username: `auth_${JAVIER_AUTH_UID}`, role: "user" },
      ],
    }),
    ttlMs: 0,
    clock: () => 1_000,
    ...extra,
  };
}

describe("SupabaseHealthRecordKeyResolver", () => {
  it("adds the auth alias when the confirmed email matches the username", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([JAVIER_AUTH_ROW]),
    );

    const keys = await resolver.resolve({
      username: "javier.alayon@ulpgc.es",
      userId: "8",
    });

    expect(keys).toEqual([
      "javier.alayon@ulpgc.es",
      `auth_${JAVIER_AUTH_UID}`,
    ]);
  });

  it("matches case-insensitively on email", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([JAVIER_AUTH_ROW]),
    );

    const keys = await resolver.resolve({
      username: "Javier.Alayon@ULPGC.es",
      userId: "8",
    });

    expect(keys).toContain(`auth_${JAVIER_AUTH_UID}`);
  });

  it("matches the administered app_user_id link even without an email match", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([
        row({
          id: JAVIER_AUTH_UID,
          email: "h2train-participant8@users.h2train.invalid",
          email_confirmed_at: "2026-11-13T12:14:31.000Z",
          app_metadata: { app_user_id: 8, role: "user" },
        }),
      ]),
    );

    const keys = await resolver.resolve({
      username: "H2TRAIN-Participant8",
      userId: "8",
    });

    expect(keys).toEqual([
      "H2TRAIN-Participant8",
      `auth_${JAVIER_AUTH_UID}`,
    ]);
  });

  it("ignores an unconfirmed email as a link source but keeps the administered link", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([
        row({
          id: JAVIER_AUTH_UID,
          email: "javier.alayon@ulpgc.es",
          app_metadata: { app_user_id: 8 },
        }),
      ]),
    );

    const keys = await resolver.resolve({
      username: "other.user@ulpgc.es",
      userId: "8",
    });

    expect(keys).toEqual([
      "other.user@ulpgc.es",
      `auth_${JAVIER_AUTH_UID}`,
    ]);
  });

  it("resolves the account UserID from the users table when it is not provided", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([JAVIER_AUTH_ROW]),
    );

    const keys = await resolver.resolve({
      username: "javier.alayon@ulpgc.es",
    });

    expect(keys).toEqual([
      "javier.alayon@ulpgc.es",
      `auth_${JAVIER_AUTH_UID}`,
    ]);
  });

  it("returns only the canonical username when no identity is linked", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([
        row({
          id: "aa6cbf21-7d57-4eb3-9300-fc0e5f4dc39f",
          email: "prueba@example.com",
          email_confirmed_at: "2026-11-07T00:02:29.000Z",
          app_metadata: {},
        }),
      ]),
    );

    const keys = await resolver.resolve({
      username: "javier.alayon@ulpgc.es",
      userId: "8",
    });

    expect(keys).toEqual(["javier.alayon@ulpgc.es"]);
  });

  it("keeps the canonical username first and never duplicates it", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([JAVIER_AUTH_ROW]),
    );

    const keys = await resolver.resolve({
      username: "javier.alayon@ulpgc.es",
      userId: "8",
    });

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("javier.alayon@ulpgc.es");
  });

  it("fails closed when the auth admin scan reports an error", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([], {}, async () => ({
        data: null,
        error: { message: "boom" },
      })),
    );

    await expect(
      resolver.resolve({ username: "javier.alayon@ulpgc.es", userId: "8" }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("fails closed when the identity catalog exceeds the scan limit", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) =>
      row({
        id: `${String(index).padStart(8, "0")}-1111-4222-8333-444444444444`,
        email: `user${index}@users.h2train.invalid`,
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
        app_metadata: { app_user_id: index },
      }),
    );
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([], { maxScanPages: 2 }, async () => ({
        data: { users: fullPage },
        error: null,
      })),
    );

    await expect(
      resolver.resolve({ username: "javier.alayon@ulpgc.es", userId: "8" }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("fails closed when the users lookup cannot run", async () => {
    const options = resolverOptions([JAVIER_AUTH_ROW]);
    (options.users as FakePersistenceGateway).selectErrors.set(
      "users",
      new Error("db down"),
    );
    const resolver = new SupabaseHealthRecordKeyResolver(options);

    await expect(
      resolver.resolve({ username: "javier.alayon@ulpgc.es" }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("rejects an empty username with a validation error", async () => {
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions([]),
    );

    await expect(resolver.resolve({ username: "   " })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("caches the identity scan within the TTL window", async () => {
    let calls = 0;
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions(
        [JAVIER_AUTH_ROW],
        { ttlMs: 60_000 },
        async () => {
          calls += 1;
          return { data: { users: [JAVIER_AUTH_ROW] }, error: null };
        },
      ),
    );

    const first = await resolver.resolve({
      username: "javier.alayon@ulpgc.es",
      userId: "8",
    });
    const second = await resolver.resolve({
      username: "javier.alayon@ulpgc.es",
      userId: "8",
    });

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it("caps the resolved key set", async () => {
    const manyAliases = Array.from({ length: 50 }, (_, index) =>
      row({
        id: `${String(index).padStart(8, "0")}-1111-4222-8333-444444444444`,
        app_metadata: { app_user_id: 8 },
      }),
    );
    const resolver = new SupabaseHealthRecordKeyResolver(
      resolverOptions(manyAliases, { maxKeys: 4 }),
    );

    const keys = await resolver.resolve({
      username: "javier.alayon@ulpgc.es",
      userId: "8",
    });

    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe("javier.alayon@ulpgc.es");
  });
});
