import { describe, expect, it } from "vitest";
import { createAdminDatabaseUseCases } from "@/server/application/admin/admin-database-use-cases";
import { InMemoryAdminDatabaseRepository } from "@/server/infrastructure/testing/in-memory-admin-database-repository";
import { actorFor, makeUser } from "../helpers/fixtures";

const adminActor = actorFor(
  makeUser({ id: "admin-1", username: "root", role: "admin" }),
);
const doctorActor = actorFor(
  makeUser({ id: "doctor-1", username: "doctor", role: "doctor" }),
);

function setup() {
  const repository = new InMemoryAdminDatabaseRepository({
    users: { records: [{ UserID: 1 }, { UserID: 2 }] },
    insulindata: { records: [{ id: "row-1" }], accessible: false },
  });
  return { repository, useCases: createAdminDatabaseUseCases(repository) };
}

describe("admin database use cases", () => {
  it("allows only admins to list tables", async () => {
    const { useCases } = setup();

    await expect(useCases.listTables(doctorActor)).rejects.toMatchObject({
      statusCode: 403,
    });

    const result = await useCases.listTables(adminActor);
    expect(result.totalRecords).toBe(3);
    expect(result.totalCount).toBe(2);
    expect(result.accessibleCount).toBe(1);
  });

  it("rejects unsafe table names and out-of-range limits", async () => {
    const { useCases } = setup();

    await expect(
      useCases.getTableData(adminActor, "users;drop", 10),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      useCases.getTableData(adminActor, "users", 0),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      useCases.getTableData(adminActor, "users", 1001),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns a bounded table page for admins", async () => {
    const { useCases } = setup();
    const page = await useCases.getTableData(adminActor, "users", 1);
    expect(page.returnedRecords).toBe(1);
    expect(page.totalRecords).toBe(2);
    expect(page.limit).toBe(1);
  });
});
