import { describe, expect, it, vi } from "vitest";
import { createAdminDatabaseUseCases } from "@/server/application/admin/admin-database-use-cases";
import { createLogicalCopy, createTableExport, readCompleteAdminTable } from "@/server/application/admin/admin-database-downloads";
import { InMemoryAdminDatabaseRepository } from "@/server/infrastructure/testing/in-memory-admin-database-repository";
import { decryptLogicalCopy, encryptLogicalCopy } from "@/server/infrastructure/crypto/logical-backup";
import { createAdminDatabaseDownloadHandlers } from "@/server/http/handlers/admin-database-downloads";
import { createAdminDatabaseHttpHandlers } from "@/server/http/handlers/admin-database";
import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import { initialPrivacyStatus } from "@/server/domain/privacy";
import type { Session } from "@/server/domain/session";
import type { ActiveActor, UserRole } from "@/server/domain/user";
import { makeUser } from "../helpers/fixtures";
import { decryptLogicalCopyFile } from "../../scripts/decrypt-logical-copy.mjs";

const actor: ActiveActor = { userId: "1", username: "admin", role: "admin" };
const password = "fictional-test-passphrase";
function setup(count = 2005) {
  const repository = new InMemoryAdminDatabaseRepository({
    users: { records: Array.from({ length: count }, (_, index) => ({ UserID: index + 1, Username: index === 0 ? '=FORMULA("a,b")' : `u-${index}`, PasswordHash: "must-not-leak" })) },
    insulindata: { records: [{ id: 1, username: "u-1", nested: { token: "must-not-leak", dose: 3 } }] },
    fooddata: { records: [] }, exercisedata: { records: [] }, periodrecords: { records: [] }, mooddata: { records: [] }, polar_data: { records: [] },
  });
  return { repository, database: createAdminDatabaseUseCases(repository) };
}
function auth(role: UserRole = "admin", state: "initial" | "banner" | "complete" | "absent" = "complete"): AuthUseCases {
  const session: Session = { token: "fictional-token", expiresAt: "2026-12-31T23:59:59Z", method: "username", user: makeUser({ id: "1", username: "admin", role }), ...(state === "absent" ? {} : { privacy: { ...initialPrivacyStatus(), state } }) };
  return { login: vi.fn(async () => session), getSession: vi.fn(async () => session), logout: vi.fn(async () => undefined) };
}

describe("complete admin exports and encrypted logical copies", () => {
  it("reads all 2005 rows through three ordered pages without leaking nested credentials", async () => {
    const { database } = setup();
    const spy = vi.spyOn(database, "getTableData");
    const download = await createTableExport(database, actor, "users", "json");
    const parsed = JSON.parse(download.content);
    expect(parsed.recordCount).toBe(2005);
    expect(parsed.data.at(-1).UserID).toBe(2005);
    expect(spy.mock.calls.map(call => call[3])).toEqual([0, 1000, 2000]);
    expect(download.content).not.toContain("must-not-leak");
    const health = await createTableExport(database, actor, "insulindata", "json");
    expect(JSON.parse(health.content).data[0].nested).toEqual({ dose: 3 });
  });
  it("escapes CSV quotes/commas and neutralizes spreadsheet formulas", async () => {
    const { database } = setup(1);
    const result = await createTableExport(database, actor, "users", "csv");
    expect(result.content).toContain('"\'=FORMULA(""a,b"")"');
    expect(result.content).not.toContain("PasswordHash");
  });
  it("fails closed for server truncation, repeated PKs and changing counts", async () => {
    for (const kind of ["short", "duplicate", "changed"] as const) {
      const { database } = setup();
      const original = database.getTableData.bind(database);
      vi.spyOn(database, "getTableData").mockImplementation(async (a, table, limit, offset) => {
        const page = await original(a, table, limit, offset);
        if (kind === "short" && offset === 0) return { ...page, data: page.data.slice(0, 999), returnedRecords: 999 };
        if (kind === "duplicate" && offset === 1000) return { ...page, data: [{ ...page.data[0], UserID: 1000 }, ...page.data.slice(1)] };
        return kind === "changed" && offset === 1000 ? { ...page, totalRecords: 2006 } : page;
      });
      await expect(readCompleteAdminTable(database, actor, "users")).rejects.toMatchObject({ statusCode: 409 });
    }
  });
  it("includes users, all health tables and linked Kubios in the versioned manifest", async () => {
    const { database } = setup(2);
    const kubios = [{ userId: 1, status: "ready", results: [{ measured_at: "2026-01-01", rmssd_ms: 42 }] }];
    const copy = await createLogicalCopy(database, actor, vi.fn(async () => kubios));
    expect(copy.manifest.version).toBe(1);
    expect(Object.keys(copy.tables)).toHaveLength(7);
    expect(copy.manifest.counts.users).toBe(2);
    expect(copy.manifest.kubiosParticipants).toBe(1);
    expect(copy.kubios).toEqual(kubios);
    expect(JSON.stringify(copy)).not.toContain("must-not-leak");
  });
  it("refuses a copy when Kubios fails, a table is missing or a linked user is absent", async () => {
    const { database } = setup(1);
    await expect(createLogicalCopy(database, actor, async () => { throw new Error("upstream failure"); })).rejects.toThrow("upstream failure");
    await expect(createLogicalCopy(database, actor, async () => [{ userId: 999 }])).rejects.toMatchObject({ statusCode: 409 });
    const missing = createAdminDatabaseUseCases(new InMemoryAdminDatabaseRepository({ users: { records: [] } }));
    await expect(createLogicalCopy(missing, actor, async () => [])).rejects.toMatchObject({ statusCode: 409 });
  });
  it("encrypts with randomized salt/nonce and rejects wrong password, tampering and KDF edits", async () => {
    const input = { manifest: { version: 1 }, tables: { users: [{ UserID: 1 }] } };
    const first = await encryptLogicalCopy(input, password);
    const second = await encryptLogicalCopy(input, password);
    expect(first.salt).not.toBe(second.salt); expect(first.nonce).not.toBe(second.nonce);
    expect(first.kdf).toEqual({ name: "scrypt", N: 131072, r: 8, p: 1, keyLength: 32 });
    expect(JSON.stringify(first)).not.toContain("UserID");
    await expect(decryptLogicalCopy(first, password)).resolves.toEqual(input);
    expect(JSON.parse(await decryptLogicalCopyFile(first, password))).toEqual(input);
    await expect(decryptLogicalCopy(first, "incorrect-test-password")).rejects.toThrow();
    const changed = Buffer.from(first.ciphertext, "base64"); changed[0] = (changed[0] ?? 0) ^ 1;
    await expect(decryptLogicalCopy({ ...first, ciphertext: changed.toString("base64") }, password)).rejects.toThrow();
    await expect(decryptLogicalCopyFile({ ...first, ciphertext: changed.toString("base64") }, password)).rejects.toThrow();
    await expect(decryptLogicalCopy({ ...first, version: 2 } as never, password)).rejects.toThrow();
    await expect(decryptLogicalCopy({ ...first, kdf: { ...first.kdf, N: 262144 } } as never, password)).rejects.toThrow();
    await expect(encryptLogicalCopy(input, "short")).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["user", "doctor"] as const)("denies export and copy to %s before Kubios/encryption", async role => {
    const { database } = setup(1);
    const readKubios = vi.fn(async () => []), encrypt = vi.fn(async () => ({}));
    const handlers = createAdminDatabaseDownloadHandlers({ auth: auth(role), database, readKubios, encrypt });
    expect((await handlers.exportTable({ sessionToken: "test", query: { table: "users", format: "json" } })).status).toBe(403);
    expect((await handlers.logicalBackup({ sessionToken: "test", body: { password } })).status).toBe(403);
    expect(readKubios).not.toHaveBeenCalled(); expect(encrypt).not.toHaveBeenCalled();
  });
  it.each(["initial", "absent"] as const)("denies all database HTTP access for privacy %s", async state => {
    const { database } = setup(1);
    const readKubios = vi.fn(async () => []), encrypt = vi.fn(async () => ({}));
    const handlers = createAdminDatabaseDownloadHandlers({ auth: auth("admin", state), database, readKubios, encrypt });
    const explorer = createAdminDatabaseHttpHandlers(auth("admin", state), database);
    for (const result of await Promise.all([handlers.exportTable({ sessionToken: "test", query: { table: "users", format: "json" } }), handlers.logicalBackup({ sessionToken: "test", body: { password } }), explorer.tables({ sessionToken: "test" }), explorer.tableData({ sessionToken: "test", query: { table: "users" } })])) {
      expect(result.status).toBe(403); expect(result.body).toMatchObject({ error: { code: "PRIVACY_ACTION_REQUIRED" } });
    }
    expect(readKubios).not.toHaveBeenCalled(); expect(encrypt).not.toHaveBeenCalled();
  });
  it("returns download contract only after successful complete read; propagates failures safely", async () => {
    const { database } = setup(1);
    const encrypt = vi.fn(async () => ({ ciphertext: "fictional" }));
    const handlers = createAdminDatabaseDownloadHandlers({ auth: auth(), database, readKubios: async () => [], encrypt });
    expect((await handlers.exportTable({ sessionToken: undefined, query: {} })).status).toBe(401);
    expect((await handlers.exportTable({ sessionToken: "test", query: { table: "users", format: "sql" } })).status).toBe(400);
    expect((await handlers.logicalBackup({ sessionToken: "test", body: { password: "short" } })).status).toBe(400);
    const result = await handlers.logicalBackup({ sessionToken: "test", body: { password } });
    expect(result).toMatchObject({ status: 200, body: { filename: expect.stringMatching(/\.encrypted\.json$/), content: '{\n  "ciphertext": "fictional"\n}' } });
    const failing = createAdminDatabaseDownloadHandlers({ auth: auth(), database, readKubios: async () => { throw new Error("sensitive detail"); }, encrypt });
    const failure = await failing.logicalBackup({ sessionToken: "test", body: { password } });
    expect(failure.status).toBe(500); expect(JSON.stringify(failure)).not.toContain("sensitive detail"); expect(encrypt).toHaveBeenCalledTimes(1);
  });
});
