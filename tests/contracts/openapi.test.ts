import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, ...path: string[]): Record<string, unknown> {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) {
      throw new Error(`Expected object at ${path.join(".")}`);
    }
    current = current[key];
  }
  if (!isRecord(current)) {
    throw new Error(`Expected object at ${path.join(".")}`);
  }
  return current;
}

async function loadSpec(): Promise<Record<string, unknown>> {
  const source = await readFile(
    new URL("../../contracts/openapi.yaml", import.meta.url),
    "utf8",
  );
  const parsed: unknown = parse(source);
  if (!isRecord(parsed)) {
    throw new Error("OpenAPI document must be a mapping");
  }
  return parsed;
}

describe("authoritative OpenAPI contract", () => {
  it("declares every required route", async () => {
    const spec = await loadSpec();
    const paths = recordAt(spec, "paths");
    const requiredPaths = [
      "/api/auth/login",
      "/api/auth/session",
      "/api/auth/logout",
      "/api/users",
      "/api/users/{id}",
      "/api/users/{id}/uuid",
      "/api/users/count",
      "/api/decrypted-data",
      "/api/data",
      "/api/admin/database/tables",
      "/api/admin/database/table-data",
      "/api/kubios/me",
      "/api/kubios/hrv-results",
      "/api/kubios/export",
      "/api/cron/kubios-sync",
    ];
    expect(spec.openapi).toBe("3.1.0");
    for (const route of requiredPaths) {
      expect(paths[route], route).toBeDefined();
    }
  });

  it("keeps personal Kubios on cookie auth and cron on a separate secret", async () => {
    const spec = await loadSpec();
    expect(spec.security).toEqual([{ cookieAuth: [] }]);
    for (const endpoint of ["/api/kubios/me", "/api/kubios/hrv-results", "/api/kubios/export"]) {
      const operation = recordAt(spec, "paths", endpoint, "get");
      expect(operation.security).toBeUndefined();
      const parameters = JSON.stringify(operation.parameters ?? []);
      expect(parameters).not.toMatch(/userId|teamId|memberId/);
    }
    expect(recordAt(spec, "paths", "/api/cron/kubios-sync", "post").security).toEqual([
      { kubiosCron: [] },
    ]);
  });

  it("keeps public schemas free of credential material", async () => {
    const spec = await loadSpec();
    const serialized = JSON.stringify(spec).toLocaleLowerCase();
    expect(serialized).not.toContain("passwordhash");
    expect(serialized).not.toContain("password_hash");

    const userProperties = recordAt(
      spec,
      "components",
      "schemas",
      "User",
      "properties",
    );
    expect(Object.keys(userProperties).filter((key) => /pass|hash|secret/i.test(key))).toEqual(
      [],
    );
  });

  it("requires exactly the five decrypted collections", async () => {
    const spec = await loadSpec();
    const schema = recordAt(
      spec,
      "components",
      "schemas",
      "DecryptedDataResponse",
    );
    expect(schema.required).toEqual([
      "insulinData",
      "foodData",
      "exerciseData",
      "periodData",
      "moodData",
    ]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("documents both login identifiers and the legacy compatibility shapes", async () => {
    const spec = await loadSpec();
    const login = recordAt(spec, "paths", "/api/auth/login", "post");
    const loginContract = JSON.stringify(login);
    expect(loginContract).toContain("EmailLoginRequest");
    expect(loginContract).toContain("UsernameLoginRequest");

    const legacy = JSON.stringify(recordAt(spec, "paths", "/api/data", "get"));
    expect(legacy).toContain("LegacyAllData");
    expect(legacy).toContain("LegacyRecordList");
  });

  it("uses an HttpOnly cookie session and never a bearer token in JSON", async () => {
    const spec = await loadSpec();
    // The cron has an independent server credential; public JSON must never
    // serialize bearer/session tokens.
    const serialized = JSON.stringify(recordAt(spec, "components", "schemas"));
    expect(serialized.toLocaleLowerCase()).not.toContain("bearer");
    expect(recordAt(spec, "components", "securitySchemes", "cookieAuth")).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "dashboard_session",
    });

    const session = recordAt(spec, "components", "schemas", "SessionResponse");
    expect(session.required).toEqual(["user", "method", "expiresAt"]);
    expect(recordAt(session, "properties")).not.toHaveProperty("token");
    expect(recordAt(session, "properties")).not.toHaveProperty("access_token");
    const method = recordAt(session, "properties", "method");
    expect(method.enum).toEqual(["email", "username"]);
  });

  it("documents the user-with-data conflict and the role model", async () => {
    const spec = await loadSpec();
    const deleteUser = recordAt(
      spec,
      "paths",
      "/api/users/{id}",
      "delete",
      "responses",
      "409",
    );
    expect(JSON.stringify(deleteUser)).toContain("UserHasData");

    const problem = recordAt(spec, "components", "schemas", "Problem");
    expect(JSON.stringify(problem)).toContain("USER_HAS_DATA");

    const roles = recordAt(spec, "components", "schemas", "UserRole").enum;
    expect(roles).toEqual(["admin", "doctor", "user"]);
  });

  it("enforces the P1 username and email request contract", async () => {
    const spec = await loadSpec();
    const schemas = recordAt(spec, "components", "schemas");
    for (const name of ["UsernameLoginRequest", "UserCreateRequest", "UserUpdateRequest"]) {
      const username = recordAt(schemas, name, "properties", "username");
      expect(username.maxLength, name).toBe(100);
    }
    for (const name of ["UserCreateRequest", "UserUpdateRequest"]) {
      const email = recordAt(schemas, name, "properties", "email");
      expect(email.type, name).toBe("null");
    }
    const userEmail = recordAt(schemas, "User", "properties", "email");
    expect(userEmail.type).toEqual(["string", "null"]);
  });

  it("accepts dateFilter, the from-to range (T13) and documents decrypted-data scoping", async () => {
    const spec = await loadSpec();
    const operation = recordAt(spec, "paths", "/api/decrypted-data", "get");
    const parameters = operation.parameters;
    expect(Array.isArray(parameters)).toBe(true);
    const names = (parameters as Array<Record<string, unknown>>).map(
      (parameter) => parameter.name,
    );
    expect(names).toEqual([
      "selectedUser",
      "timeRange",
      "selectedDataType",
      "dateFilter",
      "dateFrom",
      "dateTo",
    ]);
    const dateFilter = (parameters as Array<Record<string, unknown>>).find(
      (parameter) => parameter.name === "dateFilter",
    );
    expect(recordAt(dateFilter, "schema")).toMatchObject({ format: "date" });
    for (const name of ["dateFrom", "dateTo"]) {
      const rangeParameter = (parameters as Array<Record<string, unknown>>).find(
        (parameter) => parameter.name === name,
      );
      expect(recordAt(rangeParameter, "schema")).toMatchObject({ format: "date" });
    }
    expect(String(operation.description)).toContain("normaliza siempre");
    expect(String(operation.description)).toContain("completo UTC");
    expect(String(operation.description)).toContain("YYYY-MM-DD");
    // T13: the explicit window is authoritative; timeRange does not clip it,
    // and an inverted range is a client error.
    expect(String(operation.description)).toContain("no la recorta");
    expect(String(operation.description)).toContain("anterior o igual a");
  });

  it("matches admin download failure statuses and Kubios paging bounds", async () => {
    const spec = await loadSpec();
    const exportResponses = recordAt(spec, "paths", "/api/admin/database/export", "get", "responses");
    expect(exportResponses).toHaveProperty("400");
    expect(exportResponses).toHaveProperty("401");
    expect(exportResponses).toHaveProperty("403");
    expect(exportResponses).toHaveProperty("404");
    expect(exportResponses).toHaveProperty("409");
    expect(exportResponses).toHaveProperty("503");

    const backupResponses = recordAt(spec, "paths", "/api/admin/database/logical-backup", "post", "responses");
    for (const status of ["200", "400", "401", "403", "409", "503"]) {
      expect(backupResponses).toHaveProperty(status);
    }

    const page = recordAt(spec, "components", "schemas", "AdminKubiosPage", "properties");
    expect(recordAt(page, "page").minimum).toBe(1);
    expect(recordAt(page, "pageSize")).toMatchObject({ minimum: 1, maximum: 100 });
  });
});
