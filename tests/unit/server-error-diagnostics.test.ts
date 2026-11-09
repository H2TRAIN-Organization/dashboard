import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import { createDataUseCases } from "@/server/application/data/data-use-cases";
import { ValidationError } from "@/server/domain/errors";
import type { Session } from "@/server/domain/session";
import {
  extractRequestId,
  internalErrorDiagnostic,
} from "@/server/http/error-diagnostics";
import { createDataHttpHandlers } from "@/server/http/handlers/data";
import { runApiRoute } from "@/server/http/next/route-bridge";
import { handle } from "@/server/http/problem";
import { Aes256CbcDecryptor } from "@/server/infrastructure/crypto/aes-256-cbc";
import { CryptoError } from "@/server/infrastructure/crypto/errors";
import { PersistenceError } from "@/server/infrastructure/persistence/errors";
import { SupabaseHealthDataRepository } from "@/server/infrastructure/persistence/health/health-data-repository";
import { makeUser } from "../helpers/fixtures";
import { CURRENT_KEY, PREVIOUS_KEY } from "../persistence/helpers/crypto-fixtures";
import { FakePersistenceGateway } from "../persistence/helpers/fake-gateway";

function loggedEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  return JSON.parse(String(spy.mock.calls[0]?.[0] ?? "")) as Record<string, unknown>;
}

function errorText(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitized server error diagnostics", () => {
  it("keeps only the crypto class, code and health table/field", () => {
    const error = new CryptoError(
      "DECRYPTION_FAILED",
      "fallo al descifrar insulindata.dose; ciphertext deadbeef; usuario alice",
      "insulindata.dose",
    );

    const diagnostic = internalErrorDiagnostic(error);

    expect(diagnostic).toEqual({
      type: "CryptoError",
      code: "DECRYPTION_FAILED",
      table: "insulindata",
      field: "insulindata.dose",
    });

    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("ciphertext");
  });

  it("keeps only the persistence class, code, operation, table and pg codes", () => {
    const error = new PersistenceError(
      "QUERY_FAILED",
      "respuesta Supabase: username=alice dose=4 ciphertext=deadbeef",
      {
        operation: "select",
        table: "insulindata",
        pgCode: "PGRST103",
        raiseCode: null,
      },
    );

    const diagnostic = internalErrorDiagnostic(error);

    expect(diagnostic).toEqual({
      type: "PersistenceError",
      code: "QUERY_FAILED",
      operation: "select",
      table: "insulindata",
      postgresCode: "PGRST103",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("alice");
    expect(JSON.stringify(diagnostic)).not.toContain("deadbeef");
  });

  it("never copies a generic message and omits unknown diagnostic properties", () => {
    const error = new TypeError(
      "Cannot read row alice with dose=4 ciphertext=deadbeef key=00112233445566778899aabbccddeeff token=secret-token",
    );

    const diagnostic = internalErrorDiagnostic(error);

    expect(diagnostic).toEqual({ type: "TypeError" });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("00112233445566778899aabbccddeeff");
    expect(serialized).not.toContain("secret-token");
  });

  it("omits unsafe request ids and falls back to the next safe header", () => {
    expect(
      internalErrorDiagnostic(new Error("raw"), "handler").requestId,
    ).toBeUndefined();

    expect(extractRequestId(["bad\ninjected", "fra1::safe-1"])).toBe(
      "fra1::safe-1",
    );
    expect(extractRequestId([null, " "])).toBeNull();
  });

  it("returns a generic private 500 and logs only sanitized route metadata", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new NextRequest(
      "https://dashboard.example/api/decrypted-data?selectedUser=all&timeRange=30d",
      {
        method: "GET",
        headers: { "x-vercel-id": "fra1::req-123" },
      },
    );

    const response = await runApiRoute(
      request,
      async () => {
        throw new Error(
          "username=alice ciphertext=deadbeef query=selectedUser key=00112233445566778899aabbccddeeff token=secret-token",
        );
      },
      { route: "/api/decrypted-data" },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Error interno del servidor",
      },
    });

    expect(loggedEntry(spy)).toEqual({
      event: "api.internal_error",
      type: "Error",
      requestId: "fra1::req-123",
      method: "GET",
      route: "/api/decrypted-data",
      stage: "route",
    });
    const serialized = errorText(spy);
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("selectedUser");
    expect(serialized).not.toContain("00112233445566778899aabbccddeeff");
    expect(serialized).not.toContain("secret-token");
  });

  it("correlates handler-level 500s with the request id and keeps the body generic", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new NextRequest(
      "https://dashboard.example/api/decrypted-data",
      {
        method: "GET",
        headers: { "x-request-id": "req-456" },
      },
    );

    const response = await runApiRoute(
      request,
      async () =>
        handle(async () => {
          throw new CryptoError(
            "MISSING_IV",
            "insulindata.dose no tiene IV; ciphertext deadbeef",
            "insulindata.dose",
          );
        }),
      { route: "/api/decrypted-data" },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Error interno del servidor",
      },
    });

    expect(loggedEntry(spy)).toEqual({
      event: "api.internal_error",
      type: "CryptoError",
      code: "MISSING_IV",
      table: "insulindata",
      field: "insulindata.dose",
      requestId: "req-456",
      method: "GET",
      route: "/api/decrypted-data",
      stage: "handler",
    });
    expect(errorText(spy)).not.toContain("deadbeef");
  });

  it("does not log expected application errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new NextRequest(
      "https://dashboard.example/api/decrypted-data",
      { method: "GET" },
    );

    const response = await runApiRoute(request, async () =>
      handle(async () => {
        throw new ValidationError("La petición no cumple el contrato");
      }),
    );

    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reproduces the global-read 500 with a legacy row and reports only safe metadata", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const gateway = new FakePersistenceGateway({
      insulindata: [
        {
          id: 1,
          username: "synthetic-user",
          insulinType: "ab".repeat(32),
          insulintype_iv: null,
          dose: "__PLAIN__4",
          dose_iv: null,
          date_time: "2026-01-15T10:00:00",
        },
      ],
    });
    const repository = new SupabaseHealthDataRepository(
      gateway,
      new Aes256CbcDecryptor({
        currentKeyHex: CURRENT_KEY,
        previousKeyHex: PREVIOUS_KEY,
      }),
    );
    const data = createDataUseCases(repository, {
      now: () => new Date("2026-01-31T12:00:00.000Z"),
    });
    const session: Session = {
      user: makeUser({
        id: "admin-1",
        username: "root",
        role: "admin",
      }),
      token: "admin-session",
      method: "username",
      expiresAt: "2026-12-31T23:59:59.000Z",
    };
    const auth: AuthUseCases = {
      login: async () => session,
      getSession: async () => session,
      logout: async () => undefined,
    };
    const handlers = createDataHttpHandlers(auth, data);
    const request = new NextRequest(
      "https://dashboard.example/api/decrypted-data?selectedUser=all&timeRange=30d&selectedDataType=all",
      {
        method: "GET",
        headers: { "x-vercel-id": "fra1::repro-1" },
      },
    );

    const response = await runApiRoute(
      request,
      async () =>
        handlers.decrypted({
          sessionToken: "admin-session",
          query: {
            selectedUser: "all",
            timeRange: "30d",
            selectedDataType: "all",
          },
        }),
      { route: "/api/decrypted-data" },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Error interno del servidor",
      },
    });

    expect(loggedEntry(spy)).toEqual({
      event: "api.internal_error",
      type: "CryptoError",
      code: "MISSING_IV",
      table: "insulindata",
      field: "insulindata.insulinType",
      requestId: "fra1::repro-1",
      method: "GET",
      route: "/api/decrypted-data",
      stage: "handler",
    });
    const serialized = errorText(spy);
    expect(serialized).not.toContain("synthetic-user");
    expect(serialized).not.toContain("ab".repeat(32));
  });
});
