import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface Metadata {
  readonly tables: Record<
    string,
    {
      readonly rowCount: number;
      readonly primaryKey: string;
      readonly columns: Record<string, unknown>;
      readonly absentColumns?: readonly string[];
    }
  >;
  readonly evidence: {
    readonly anonPasswordHashProjection: { readonly status: number; readonly valuesRead: number };
  };
  readonly credentialCheck: Record<string, { readonly usedForPersistence?: boolean; readonly role?: string }>;
}

async function loadMetadata(): Promise<Metadata> {
  const source = await readFile(
    new URL("./fixtures/schema-metadata.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(source) as Metadata;
}

describe("verified schema metadata fixture", () => {
  it("contains only the seven inspected public tables", async () => {
    const metadata = await loadMetadata();
    expect(Object.keys(metadata.tables).sort()).toEqual([
      "exercisedata",
      "fooddata",
      "insulindata",
      "mooddata",
      "periodrecords",
      "polar_data",
      "users",
    ]);
    expect(metadata.tables.users?.rowCount).toBe(21);
    expect(metadata.tables.insulindata?.rowCount).toBe(251);
    expect(metadata.tables.fooddata?.rowCount).toBe(273);
    expect(metadata.tables.exercisedata?.rowCount).toBe(44);
    expect(metadata.tables.periodrecords?.rowCount).toBe(5);
    expect(metadata.tables.mooddata?.rowCount).toBe(49);
    expect(metadata.tables.polar_data?.rowCount).toBe(0);
  });

  it("records the real users columns and the absent email/createdAt", async () => {
    const metadata = await loadMetadata();
    const users = metadata.tables.users;
    expect(users?.primaryKey).toBe("UserID");
    expect(Object.keys(users?.columns ?? {})).toEqual([
      "UserID",
      "Username",
      "PasswordHash",
      "UUID",
      "GDPRConsent",
      "GDPRConsentDate",
      "sexo",
      "bomba_insulina",
      "role",
    ]);
    expect(users?.absentColumns).toContain("email");
    expect(users?.absentColumns).toContain("createdAt");
  });

  it("records integer primary keys and IV columns for health tables", async () => {
    const metadata = await loadMetadata();
    for (const table of [
      "insulindata",
      "fooddata",
      "exercisedata",
      "periodrecords",
      "mooddata",
      "polar_data",
    ]) {
      expect(metadata.tables[table]?.primaryKey).toBe("id");
      expect(metadata.tables[table]?.columns.id).toMatchObject({ primaryKey: true });
    }
    for (const table of [
      "insulindata",
      "fooddata",
      "exercisedata",
      "periodrecords",
      "mooddata",
    ]) {
      expect(
        Object.keys(metadata.tables[table]?.columns ?? {}).some((column) =>
          column.endsWith("_iv"),
        ),
      ).toBe(true);
    }
  });

  it("keeps the anon PasswordHash evidence and the service-role key choice", async () => {
    const metadata = await loadMetadata();
    expect(metadata.evidence.anonPasswordHashProjection).toMatchObject({
      status: 200,
      valuesRead: 0,
    });
    expect(metadata.credentialCheck.SUPABASE_SECRET_KEY).toMatchObject({
      role: "anon",
      usedForPersistence: false,
    });
    expect(metadata.credentialCheck.SUPABASE_SERVICE_ROLE_KEY).toMatchObject({
      role: "service_role",
    });
  });

  it("does not contain hashes, ciphertext or PII values", async () => {
    const source = await readFile(
      new URL("./fixtures/schema-metadata.json", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\$2[aby]\$\d{2}\$/);
    expect(source).not.toMatch(/[0-9a-f]{64}/i);
    expect(source).not.toContain("@example.com");
  });
});
