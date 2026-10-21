import { describe, expect, it } from "vitest";
import {
  canListUser,
  canReadAdminDatabase,
  canReadHealthDataFor,
  canWriteUsers,
  hasCapability,
} from "@/server/domain/access-policy";
import { actorFor, makeUser } from "../helpers/fixtures";

const admin = actorFor(
  makeUser({ id: "admin-1", username: "root", role: "admin" }),
);
const doctor = actorFor(
  makeUser({ id: "doctor-1", username: "dr-house", role: "doctor" }),
);
const user = actorFor(
  makeUser({ id: "user-1", username: "alice", role: "user" }),
);

describe("role access policy", () => {
  it("gives admins user writes and database access", () => {
    expect(canWriteUsers(admin)).toBe(true);
    expect(canReadAdminDatabase(admin)).toBe(true);
    expect(hasCapability(admin, "health-data:read:all")).toBe(true);
  });

  it("gives doctors read-only visibility over every user and all health data", () => {
    expect(canWriteUsers(doctor)).toBe(false);
    expect(canReadAdminDatabase(doctor)).toBe(false);
    expect(canReadHealthDataFor(doctor, "alice")).toBe(true);
    expect(canReadHealthDataFor(doctor, "all")).toBe(true);
    expect(canListUser(doctor, "someone-else")).toBe(true);
  });

  it("restricts users to their own profile and own health data", () => {
    expect(canListUser(user, user.userId)).toBe(true);
    expect(canListUser(user, "someone-else")).toBe(false);
    expect(canReadHealthDataFor(user, "alice")).toBe(true);
    expect(canReadHealthDataFor(user, "all")).toBe(false);
    expect(canReadHealthDataFor(user, "bob")).toBe(false);
    expect(canWriteUsers(user)).toBe(false);
    expect(canReadAdminDatabase(user)).toBe(false);
  });
});
