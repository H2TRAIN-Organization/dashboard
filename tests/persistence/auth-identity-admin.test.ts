import { describe, expect, it } from "vitest";

import { SupabaseUserRepository } from "@/server/infrastructure/persistence/user/supabase-user-repository";
import { SupabaseAuthIdentityAdmin } from "@/server/infrastructure/auth/supabase-identity-admin";
import {
  deriveEmailFromUsername,
  normalizeIdentityEmail,
  syntheticLocalPart,
} from "@/server/domain/username-email";
import type { AuthIdentityAdmin } from "@/server/application/ports/auth-identity-admin";

import {
  FakePersistenceGateway,
} from "./helpers/fake-gateway";
import { fakePasswordHasher, validBcryptHash } from "./helpers/crypto-fixtures";

describe("deriveEmailFromUsername (MT49, mismas reglas que MT45)", () => {
  it("usa el username como email real cuando ya es una dirección", () => {
    expect(deriveEmailFromUsername("Ana.Yang@ULPGC.es")).toBe("ana.yang@ulpgc.es");
  });

  it("deriva un email sintético .invalid para cuentas solo-username", () => {
    expect(deriveEmailFromUsername("Ana María P.")).toBe("ana-maria-p@users.h2train.invalid");
    expect(deriveEmailFromUsername("***")).toBe("user@users.h2train.invalid");
  });

  it("normaliza y limpia la parte local sin perder acentos", () => {
    expect(syntheticLocalPart("Ángel_López-99")).toBe("angel_lopez-99");
    expect(normalizeIdentityEmail(" ÁNGEL ")).toBe("ángel");
  });
});

describe("SupabaseUserRepository con AuthIdentityAdmin (MT49)", () => {
  function setup(identityAdmin?: AuthIdentityAdmin) {
    const gateway = new FakePersistenceGateway({ users: [] });
    const repository = new SupabaseUserRepository(
      gateway,
      fakePasswordHasher(),
      undefined,
      identityAdmin,
    );
    return { gateway, repository };
  }

  it("crea la identidad GoTrue con email derivado, app_user_id y rol", async () => {
    const identities: unknown[] = [];
    const identityAdmin: AuthIdentityAdmin = {
      async createIdentity(input) {
        identities.push(input);
      },
    };
    const { repository } = setup(identityAdmin);

    const user = await repository.create({
      username: "nueva-cuenta",
      password: "correct",
      role: "user",
      gdprConsent: true,
    });

    expect(user.username).toBe("nueva-cuenta");
    expect(identities).toEqual([
      {
        email: "nueva-cuenta@users.h2train.invalid",
        password: "correct",
        appUserId: Number(user.id),
        role: "user",
      },
    ]);
  });

  it("compensa el alta eliminando la fila si la identidad falla", async () => {
    const gateway = new FakePersistenceGateway({ users: [] });
    gateway.rpcHandler = (name) => (name === "t009_delete_user" ? true : null);
    let createCalls = 0;
    const identityAdmin: AuthIdentityAdmin = {
      async createIdentity() {
        createCalls += 1;
        throw new Error("already registered");
      },
    };
    const repository = new SupabaseUserRepository(
      gateway,
      fakePasswordHasher(),
      undefined,
      identityAdmin,
    );

    await expect(
      repository.create({
        username: "duplicada",
        password: "correct",
        role: "user",
        gdprConsent: false,
      }),
    ).rejects.toMatchObject({ message: "already registered" });

    expect(createCalls).toBe(1);
    const compensate = gateway.rpcCalls.find((call) => call.name === "t009_delete_user");
    expect(compensate).toBeDefined();
  });

  it("sin identityAdmin el alta es exactamente la legacy", async () => {
    const { gateway, repository } = setup(undefined);
    const user = await repository.create({
      username: "legacy",
      password: "correct",
      role: "doctor",
      gdprConsent: false,
    });
    expect(user.username).toBe("legacy");
    expect(gateway.rpcCalls.filter((call) => call.name === "auth_username_set")).toHaveLength(0);
  });

  it("el insert nunca expone la contraseña en claro", async () => {
    const { gateway, repository } = setup(undefined);
    await repository.create({
      username: "hash-only",
      password: "correct",
      role: "user",
      gdprConsent: false,
    });
    const insert = gateway.insertCalls[0];
    expect(insert?.values.PasswordHash).toBe(validBcryptHash());
    expect(JSON.stringify(insert?.values)).not.toContain("correct");
  });
});

describe("SupabaseAuthIdentityAdmin (MT49)", () => {
  function fakeClient(result: { error: { message: string } | null }) {
    return {
      auth: {
        admin: {
          createUser: async () => result,
        },
      },
    } as never;
  }

  it("crea la identidad confirmada con el vínculo app_metadata", async () => {
    const calls: unknown[] = [];
    const client = {
      auth: {
        admin: {
          createUser: async (attributes: unknown) => {
            calls.push(attributes);
            return { data: { user: { id: "uuid" } }, error: null };
          },
        },
      },
    } as never;
    await new SupabaseAuthIdentityAdmin(client).createIdentity({
      email: "a@users.h2train.invalid",
      password: "secret",
      appUserId: 7,
      role: "doctor",
    });
    expect(calls[0]).toMatchObject({
      email: "a@users.h2train.invalid",
      email_confirm: true,
      app_metadata: { app_user_id: 7, role: "doctor" },
    });
  });

  it("traduce el email duplicado a conflicto y el resto a 503", async () => {
    const duplicate = new SupabaseAuthIdentityAdmin(
      fakeClient({ error: { message: "User already registered" } }),
    );
    await expect(
      duplicate.createIdentity({ email: "a@x.test", password: "s", appUserId: 1, role: "user" }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const rejected = new SupabaseAuthIdentityAdmin(
      fakeClient({ error: { message: "signup disabled" } }),
    );
    await expect(
      rejected.createIdentity({ email: "a@x.test", password: "s", appUserId: 1, role: "user" }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("integración de seed y dominio (MT45 ↔ MT49)", () => {
  it("el email derivado coincide con la regla del script de siembra", async () => {
    const { deriveEmail } = await import("../../scripts/seed-auth-users.mjs");
    for (const username of ["Ana María P.", "jiahao.yang@ulpgc.es", "nueva-cuenta"]) {
      expect(deriveEmailFromUsername(username)).toBe(deriveEmail({ username }).email);
    }
  });
});
