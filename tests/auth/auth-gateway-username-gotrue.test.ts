import { describe, expect, it } from "vitest";
import { createAuthGateway } from "@/server/infrastructure/auth/auth-gateway";
import { createSessionTokenCodec } from "@/server/infrastructure/auth/session-token";
import {
  FakeClock,
  FakeEmailTransport,
  FakeLimiter,
  FakePasswordVerifier,
  FakeSessionStore,
  FakeUserStore,
  emailUser,
  makeUser,
  successEmail,
} from "./doubles";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/**
 * MT48: el login por username delega en GoTrue (password grant con el email
 * resuelto por la RPC de Vault) con los mismos invariantes que el login por
 * email. El camino legacy bcrypt solo sobrevive mientras la migración MT46 no
 * esté aplicada (ver auth-gateway-username.test.ts) y se retira en el cutover.
 */
function setup() {
  const clock = new FakeClock(NOW);
  const user = makeUser({
    id: "42",
    username: "alice",
    email: null,
    role: "user",
  });
  const users = new FakeUserStore([user], new Map());
  users.vaultAvailable = true;
  users.publishUsernameEmail("alice", "alice@example.com");
  const passwords = new FakePasswordVerifier();
  const sessions = new FakeSessionStore();
  const limiter = new FakeLimiter();
  const email = new FakeEmailTransport();
  const codec = createSessionTokenCodec(Buffer.alloc(32, 4), {
    now: () => clock.now(),
  });
  const gateway = createAuthGateway({
    users,
    passwords,
    email,
    sessions,
    limiter,
    tokens: codec,
    clock,
    sessionTtlSeconds: 8 * 60 * 60,
  });
  return { clock, user, users, passwords, sessions, limiter, email, codec, gateway };
}

describe("username authentication via GoTrue (MT48)", () => {
  it("emite sesión opaca tras el password grant y el vínculo por app_metadata", async () => {
    const { gateway, sessions, limiter, email, codec } = setup();
    email.signInResult = successEmail(
      emailUser({
        email: "alice@example.com",
        appMetadata: { role: "user", app_user_id: "42" },
      }),
    );
    email.verifiedUser = emailUser({
      email: "alice@example.com",
      appMetadata: { role: "user", app_user_id: "42" },
    });

    const session = await gateway.authenticateByUsername("alice", "correct");

    expect(session).not.toBeNull();
    expect(session?.user).toMatchObject({ id: "42", username: "alice", role: "user" });
    expect(session?.method).toBe("username");
    expect(sessions.registerCalls).toHaveLength(1);
    expect(limiter.resetKeys).toHaveLength(1);
    expect(email.signInResult).toBeDefined();
    const payload = codec.open(session?.token ?? "");
    expect(payload?.method).toBe("username");
    // El access token de Supabase viaja cifrado dentro de la sesión opaca.
    expect(payload?.supabaseAccessToken).toBe("supabase-access-token-secret-value");
  });

  it("no consulta bcrypt ni GoTrue con un username desconocido y falla cerrado", async () => {
    const { gateway, email, passwords, sessions } = setup();
    email.verifiedUser = emailUser();
    const session = await gateway.authenticateByUsername("nobody", "whatever");

    expect(session).toBeNull();
    expect(sessions.size()).toBe(0);
    expect(passwords.verifyCalls).toHaveLength(0);
    expect(email.getUserCalls).toBe(0);
  });

  it("rechaza la ambigüedad de identidades sin elegir ninguna", async () => {
    const { users, gateway, sessions, email } = setup();
    users.resolveAmbiguous = true;
    const session = await gateway.authenticateByUsername("alice", "correct");

    expect(session).toBeNull();
    expect(sessions.size()).toBe(0);
    expect(email.getUserCalls).toBe(0);
  });

  it("falla cerrado con contraseña incorrecta en GoTrue", async () => {
    const { gateway, sessions } = setup();
    // signInResult por defecto: invalid_credentials.
    const session = await gateway.authenticateByUsername("alice", "wrong");
    expect(session).toBeNull();
    expect(sessions.size()).toBe(0);
  });

  it("verifica el access token con getUser y compara el email normalizado", async () => {
    const { gateway, sessions, email } = setup();
    email.signInResult = successEmail(
      emailUser({ email: "alice@example.com", appMetadata: { role: "user", app_user_id: "42" } }),
    );
    // getUser devuelve otra identidad: la firma no es válida para esta cuenta.
    email.verifiedUser = emailUser({
      email: "otra@example.com",
      appMetadata: { role: "user", app_user_id: "42" },
    });

    const session = await gateway.authenticateByUsername("alice", "correct");
    expect(session).toBeNull();
    expect(sessions.size()).toBe(0);
  });

  it("falla cerrado si el email de GoTrue no está confirmado", async () => {
    const { gateway, sessions, email } = setup();
    email.signInResult = successEmail(
      emailUser({ email: "alice@example.com", appMetadata: { role: "user", app_user_id: "42" } }),
    );
    email.verifiedUser = emailUser({
      email: "alice@example.com",
      emailConfirmedAt: null,
      appMetadata: { role: "user", app_user_id: "42" },
    });

    const session = await gateway.authenticateByUsername("alice", "correct");
    expect(session).toBeNull();
    expect(sessions.size()).toBe(0);
  });

  it("falla cerrado si app_metadata.role contradice el rol de public.users", async () => {
    const { gateway, sessions, email } = setup();
    email.signInResult = successEmail(
      emailUser({ email: "alice@example.com", appMetadata: { role: "admin", app_user_id: "42" } }),
    );
    email.verifiedUser = emailUser({
      email: "alice@example.com",
      appMetadata: { role: "admin", app_user_id: "42" },
    });

    await expect(gateway.authenticateByUsername("alice", "correct")).rejects.toMatchObject({
      name: "AuthConfigurationError",
    });
    expect(sessions.size()).toBe(0);
  });

  it("usa el rate limit persistente de username y no consulta el almacén al estar bloqueado", async () => {
    const { gateway, limiter, users, email } = setup();
    limiter.allowed = false;
    const session = await gateway.authenticateByUsername("alice", "correct");
    expect(session).toBeNull();
    expect(users.resolveCalls).toHaveLength(0);
    expect(email.getUserCalls).toBe(0);
    expect(limiter.consumeKeys).toHaveLength(1);
    expect(limiter.consumeKeys[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("no toca el verificador bcrypt en la ruta GoTrue", async () => {
    const { gateway, passwords, email } = setup();
    email.signInResult = successEmail(
      emailUser({ email: "alice@example.com", appMetadata: { role: "user", app_user_id: "42" } }),
    );
    email.verifiedUser = emailUser({
      email: "alice@example.com",
      appMetadata: { role: "user", app_user_id: "42" },
    });

    await gateway.authenticateByUsername("alice", "correct");
    expect(passwords.verifyCalls).toHaveLength(0);
    expect(passwords.dummyCalls).toBe(0);
  });
});
