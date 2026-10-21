import { describe, expect, it } from "vitest";
import { createUserUseCases } from "@/server/application/users/user-use-cases";
import { InMemoryUserDataPresence } from "@/server/infrastructure/testing/in-memory-user-data-presence";
import { InMemoryUserRepository } from "@/server/infrastructure/testing/in-memory-user-repository";
import { actorFor, makeUser } from "../helpers/fixtures";

const admin = makeUser({
  id: "admin-1",
  username: "root",
  email: "root@example.com",
  role: "admin",
  uuid: "admin-external-uuid",
});
const doctor = makeUser({
  id: "doctor-1",
  username: "doctor",
  role: "doctor",
});
const user = makeUser({
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  role: "user",
  uuid: "alice-external-uuid",
});

function setup() {
  const repository = new InMemoryUserRepository([admin, doctor, user]);
  const presence = new InMemoryUserDataPresence([user.id]);
  const useCases = createUserUseCases(repository, presence);
  return { repository, presence, useCases };
}

const adminActor = actorFor(admin);
const doctorActor = actorFor(doctor);
const userActor = actorFor(user);

describe("user use cases", () => {
  it("lists all users for admin and doctor, but only self for a regular user", async () => {
    const { useCases } = setup();

    const adminPage = await useCases.list(adminActor, {});
    expect(adminPage.total).toBe(3);

    const doctorPage = await useCases.list(doctorActor, { search: "ali" });
    expect(doctorPage.users.map((entry) => entry.username)).toEqual(["alice"]);

    const userPage = await useCases.list(userActor, { role: "admin" });
    expect(userPage.total).toBe(0);
    expect(await useCases.count(userActor)).toBe(1);
  });

  it("blocks writes from doctors and regular users", async () => {
    const { useCases } = setup();

    await expect(
      useCases.create(doctorActor, {
        username: "new-user",
        email: null,
        password: "not-a-real-password",
        role: "user",
        gdprConsent: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    await expect(useCases.update(userActor, user.id, { role: "admin" })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(useCases.clearUuid(doctorActor, user.id)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("creates users without returning credentials and clears UUIDs as admin", async () => {
    const { repository, useCases } = setup();

    const created = await useCases.create(adminActor, {
      username: "new-user",
      email: "new@example.com",
      password: "plain-input-not-persisted-by-fixture",
      role: "user",
      gdprConsent: true,
    });
    expect(created.username).toBe("new-user");
    expect(Object.keys(created)).not.toContain("password");
    expect(JSON.stringify(created)).not.toContain("plain-input");

    const cleared = await useCases.clearUuid(adminActor, admin.id);
    expect(cleared.uuid).toBeNull();
    expect((await repository.findById(admin.id))?.uuid).toBeNull();
  });

  it("returns 404 for unknown users and 409 when deleting a user with data", async () => {
    const { useCases } = setup();

    await expect(useCases.get(adminActor, "missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });

    await expect(useCases.delete(adminActor, user.id)).rejects.toMatchObject({
      statusCode: 409,
      code: "USER_HAS_DATA",
    });
  });

  it("deletes users without data and blocks doctors", async () => {
    const { useCases } = setup();

    await expect(useCases.delete(adminActor, doctor.id)).resolves.toBeUndefined();
    await expect(useCases.get(adminActor, doctor.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(useCases.delete(doctorActor, admin.id)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
