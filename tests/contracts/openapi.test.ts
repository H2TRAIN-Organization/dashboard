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
    ];
    expect(spec.openapi).toBe("3.1.0");
    for (const route of requiredPaths) {
      expect(paths[route], route).toBeDefined();
    }
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

  it("accepts dateFilter and documents decrypted-data scoping", async () => {
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
    ]);
    expect(String(operation.description)).toContain("selectedUser=all");
  });
});
