import { describe, expect, it } from "vitest";

import { PostgrestUsernameVault } from "@/server/infrastructure/persistence/user/postgrest-username-vault";
import { SupabaseUserRepository } from "@/server/infrastructure/persistence/user/supabase-user-repository";
import { mapUserRow } from "@/server/infrastructure/persistence/user/user-mapper";
import { PersistenceError } from "@/server/infrastructure/persistence/errors";
import type { UsernameVault } from "@/server/application/ports/username-vault";

import {
  FakePersistenceGateway,
  type FakeRow,
} from "./helpers/fake-gateway";
import { fakePasswordHasher } from "./helpers/crypto-fixtures";

const MIGRATION_MISSING = new PersistenceError(
  "MIGRATION_REQUIRED",
  "Falta la migración de MT46.",
  { operation: "auth_username_resolve" },
);

function migrationUnavailableGateway(): FakePersistenceGateway {
  const gateway = new FakePersistenceGateway();
  gateway.rpcError = MIGRATION_MISSING;
  return gateway;
}

function newVault(gateway: FakePersistenceGateway): PostgrestUsernameVault {
  return new PostgrestUsernameVault(gateway);
}

describe("PostgrestUsernameVault", () => {
  it("resuelve el username a un UserID canónico con una única fila", async () => {
    const gateway = new FakePersistenceGateway();
    gateway.rpcHandler = () => [{ user_id: 42, email: "a@x.test" }];
    const vault = newVault(gateway);

    await expect(vault.resolveUserIdByUsername("  alice ")).resolves.toBe("42");
    expect(gateway.rpcCalls).toEqual([
      { name: "auth_username_resolve", args: { p_username: "alice" } },
    ]);
  });

  it("devuelve null sin filas y lanza USERNAME_AMBIGUOUS con dos", async () => {
    const empty = new FakePersistenceGateway();
    empty.rpcHandler = () => [];
    await expect(newVault(empty).resolveUserIdByUsername("x")).resolves.toBeNull();

    const ambiguous = new FakePersistenceGateway();
    ambiguous.rpcHandler = () => [
      { user_id: 1, email: "a@x.test" },
      { user_id: 2, email: "b@x.test" },
    ];
    await expect(newVault(ambiguous).resolveUserIdByUsername("x"))
      .rejects.toMatchObject({ code: "USERNAME_AMBIGUOUS" });
  });

  it("degrada a null mientras la migración de MT46 no esté aplicada", async () => {
    const vault = newVault(migrationUnavailableGateway());
    await expect(vault.resolveUserIdByUsername("alice")).resolves.toBeNull();
  });

  it("descifra por lotes y omite filas sin username", async () => {
    const gateway = new FakePersistenceGateway();
    gateway.rpcHandler = () => [
      { user_id: 1, username: "alice" },
      { user_id: 2, username: null },
      { user_id: null, username: "orphan" },
    ];
    const names = await newVault(gateway).displayNames(["1", "2", "3"]);
    expect(Array.from(names.entries())).toEqual([["1", "alice"]]);
    expect(gateway.rpcCalls[0]).toEqual({
      name: "auth_username_display_batch",
      args: { p_user_ids: [1, 2, 3] },
    });
  });

  it("espeja el username y devuelve false solo si falta la migración", async () => {
    const gateway = new FakePersistenceGateway();
    gateway.rpcHandler = () => null;
    await expect(newVault(gateway).mirrorUsername("7", "nuevo")).resolves.toBe(true);
    expect(gateway.rpcCalls[0]).toEqual({
      name: "auth_username_set",
      args: { p_user_id: 7, p_username: "nuevo" },
    });

    await expect(
      newVault(migrationUnavailableGateway()).mirrorUsername("7", "nuevo"),
    ).resolves.toBe(false);
  });

  it("valida el identificador antes de llamar a la RPC", async () => {
    const gateway = new FakePersistenceGateway();
    await expect(newVault(gateway).mirrorUsername("no-numérico", "x"))
      .rejects.toMatchObject({ code: "MAPPING_FAILED" });
    expect(gateway.rpcCalls).toHaveLength(0);
  });
});

describe("SupabaseUserRepository con UsernameVault", () => {
  const seedUsers: readonly FakeRow[] = [
    {
      UserID: 1,
      Username: "alice",
      UUID: null,
      GDPRConsent: true,
      GDPRConsentDate: null,
      role: "user",
    },
  ];

  function setupWithVault(options: {
    rpcHandler?: (name: string, args: Record<string, unknown>) => unknown;
  } = {}) {
    const gateway = new FakePersistenceGateway({ users: seedUsers });
    if (options.rpcHandler) {
      gateway.rpcHandler = options.rpcHandler;
    }
    const vault = newVault(gateway);
    const repository = new SupabaseUserRepository(
      gateway,
      fakePasswordHasher(),
      vault,
    );
    return { gateway, vault, repository };
  }

  it("resuelve findByUsername por Vault y lee la fila por UserID", async () => {
    const { gateway, repository } = setupWithVault({
      rpcHandler: (name) => (name === "auth_username_resolve" ? [{ user_id: 1, email: null }] : null),
    });

    const user = await repository.findByUsername("alice");
    expect(user?.id).toBe("1");
    expect(user?.username).toBe("alice");
    // La resolución no consulta la columna legacy por username.
    expect(gateway.rpcCalls[0]?.name).toBe("auth_username_resolve");
  });

  it("cae a la columna legacy cuando Vault no resuelve", async () => {
    const { gateway, repository } = setupWithVault({
      rpcHandler: () => [],
    });

    const user = await repository.findByUsername("alice");
    expect(user?.id).toBe("1");
    expect(gateway.selectCalls.at(-1)?.request.filters).toEqual([
      { kind: "eq", column: "Username", value: "alice" },
    ]);
  });

  it("espeja el username cifrado al crear y al actualizar", async () => {
    const { gateway, repository } = setupWithVault({
      rpcHandler: (name) => (name === "t009_update_user" ? [{ UserID: 1, Username: "nuevo" }] : null),
    });

    await repository.create({
      username: "dave",
      password: "correct",
      role: "user",
      gdprConsent: false,
    });
    const mirrorCreate = gateway.rpcCalls.find(
      (call) => call.name === "auth_username_set",
    );
    expect(mirrorCreate?.args).toMatchObject({ p_username: "dave" });

    await repository.update("1", { username: "nuevo" });
    const mirrorUpdate = gateway.rpcCalls.filter(
      (call) => call.name === "auth_username_set",
    );
    expect(mirrorUpdate.at(-1)?.args).toMatchObject({ p_username: "nuevo" });
  });

  it("completa los usernames de un listado cuando la columna legacy no está", async () => {
    const gateway = new FakePersistenceGateway();
    // Filas como tras el cutover: sin columna Username en el select.
    gateway.tables.set(
      "users",
      [{ UserID: 1, UUID: null, GDPRConsent: true, GDPRConsentDate: null, role: "user" }],
    );
    gateway.rpcHandler = (name) =>
      name === "auth_username_display_batch"
        ? [{ user_id: 1, username: "alice-descifrada" }]
        : null;
    const repository = new SupabaseUserRepository(
      gateway,
      fakePasswordHasher(),
      newVault(gateway),
    );

    const page = await repository.list({});
    expect(page.users[0]?.username).toBe("alice-descifrada");
  });

  it("no llama a Vault cuando la columna legacy está presente", async () => {
    const { gateway, repository } = setupWithVault();
    await repository.list({});
    expect(gateway.rpcCalls).toHaveLength(0);
  });
});

describe("user mapping con cutover", () => {
  it("tolera filas sin columna Username (string vacío) y completa el repositorio", () => {
    const user = mapUserRow({ UserID: 9, GDPRConsent: false, role: "user" });
    expect(user.username).toBe("");
  });

  it("sigue fallando cerrado con Username null (datos corruptos)", () => {
    expect(() => mapUserRow({ UserID: 1, Username: null })).toThrowError(
      expect.objectContaining({ code: "MAPPING_FAILED" }),
    );
  });
});

describe("puerto UsernameVault", () => {
  it("declara el contrato mínimo del cifrado de usernames", () => {
    const vault: UsernameVault = {
      resolveUserIdByUsername: async () => null,
      displayNames: async () => new Map(),
      mirrorUsername: async () => false,
    };
    expect(vault.resolveUserIdByUsername).toBeTypeOf("function");
    expect(vault.displayNames).toBeTypeOf("function");
    expect(vault.mirrorUsername).toBeTypeOf("function");
  });
});
