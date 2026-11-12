import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECORDS_PAGE_SIZE,
  DEFAULT_USERS_PAGE_SIZE,
  RECORDS_PAGE_SIZES,
  USERS_PAGE_SIZES,
  clampUsersPage,
  isRecordsPageSize,
  isUserGroupExpanded,
  isUsersPageSize,
  pageAfterDeletion,
  placeholderUser,
  usersForRecordGroups,
  usersOffset,
  usersRange,
  usersTotalPages,
  visibleMetricCards,
} from "@/lib/dashboard-data";
import type { User } from "@/lib/api-types";

function makeUser(id: string, username: string): User {
  return {
    UserID: id,
    Username: username,
    Email: null,
    UUID: null,
    GDPRConsent: false,
    GDPRConsentDate: null,
    role: "user",
    createdAt: null,
  };
}

describe("users pagination", () => {
  it("uses the DR18 page sizes and starts at 25", () => {
    expect(USERS_PAGE_SIZES).toEqual([10, 25, 50]);
    expect(DEFAULT_USERS_PAGE_SIZE).toBe(25);
    expect(isUsersPageSize(10)).toBe(true);
    expect(isUsersPageSize(25)).toBe(true);
    expect(isUsersPageSize(50)).toBe(true);
    expect(isUsersPageSize(20)).toBe(false);
  });

  it("always exposes at least one page", () => {
    expect(usersTotalPages(0, 25)).toBe(1);
    expect(usersTotalPages(1, 25)).toBe(1);
    expect(usersTotalPages(25, 25)).toBe(1);
    expect(usersTotalPages(26, 25)).toBe(2);
    expect(usersTotalPages(31, 25)).toBe(2);
    expect(usersTotalPages(51, 25)).toBe(3);
  });

  it("clamps out-of-range pages after filters or deletions", () => {
    expect(clampUsersPage(0, 31, 25)).toBe(1);
    expect(clampUsersPage(3, 31, 25)).toBe(2);
    expect(clampUsersPage(Number.NaN, 31, 25)).toBe(1);
    expect(clampUsersPage(2, 0, 25)).toBe(1);
  });

  it("reports the visible range for the current page", () => {
    expect(usersRange(0, 1, 25)).toEqual({ from: 0, to: 0 });
    expect(usersRange(31, 1, 25)).toEqual({ from: 1, to: 25 });
    expect(usersRange(31, 2, 25)).toEqual({ from: 26, to: 31 });
    expect(usersRange(31, 9, 25)).toEqual({ from: 26, to: 31 });
  });

  it("moves back one page when deleting the last row of the last page", () => {
    expect(pageAfterDeletion(2, 26, 25)).toBe(1);
    expect(pageAfterDeletion(2, 51, 25)).toBe(2);
    expect(pageAfterDeletion(1, 1, 25)).toBe(1);
    expect(pageAfterDeletion(4, 31, 25)).toBe(2);
  });
});

describe("health data record pagination", () => {
  it("uses 10 records per page by default with the shared size options", () => {
    expect(RECORDS_PAGE_SIZES).toEqual([10, 25, 50]);
    expect(DEFAULT_RECORDS_PAGE_SIZE).toBe(10);
    expect(isRecordsPageSize(10)).toBe(true);
    expect(isRecordsPageSize(25)).toBe(true);
    expect(isRecordsPageSize(50)).toBe(true);
    expect(isRecordsPageSize(2)).toBe(false);
  });

  it("paginates record groups like any other list", () => {
    expect(usersTotalPages(25, 10)).toBe(3);
    expect(clampUsersPage(4, 25, 10)).toBe(3);
    expect(usersOffset(3, 10)).toBe(20);
    expect(usersRange(25, 3, 10)).toEqual({ from: 21, to: 25 });
  });

  it("always keeps a first page for empty or out-of-range positions", () => {
    expect(usersTotalPages(0, 10)).toBe(1);
    expect(clampUsersPage(Number.NaN, 5, 10)).toBe(1);
    expect(usersRange(0, 2, 10)).toEqual({ from: 0, to: 0 });
  });
});

describe("empty metric cards", () => {
  it("hides categories without records but keeps positive counts", () => {
    const cards = [
      { key: "insulin", count: 0 },
      { key: "food", count: 2 },
      { key: "exercise", count: 0 },
      { key: "mood", count: 1 },
    ];
    expect(visibleMetricCards(cards)).toEqual([
      { key: "food", count: 2 },
      { key: "mood", count: 1 },
    ]);
  });

  it("treats invalid counts as empty", () => {
    const cards = [
      { key: "insulin", count: 0 },
      { key: "food", count: 2 },
      { key: "exercise", count: Number.NaN },
    ];
    expect(visibleMetricCards(cards)).toHaveLength(1);
  });
});

describe("health data grouping", () => {
  it("always expands the individual user's categories", () => {
    expect(isUserGroupExpanded(true, "user-1", new Set())).toBe(true);
    expect(isUserGroupExpanded(false, "user-1", new Set())).toBe(false);
    expect(isUserGroupExpanded(false, "user-1", new Set(["user-1"]))).toBe(true);
  });

  it("keeps users from the listing and appends record-only usernames", () => {
    const users = [makeUser("1", "member-1"), makeUser("2", "member-2")];
    const grouped = usersForRecordGroups(users, [
      "member-1",
      "  member-1  ",
      "member-3",
      "",
      "member-3",
    ]);

    expect(grouped.map((user) => user.Username)).toEqual([
      "member-1",
      "member-2",
      "member-3",
    ]);
    expect(grouped[2]?.UserID).toBe("username:member-3");
  });

  it("builds a neutral placeholder without inventing privileges", () => {
    const placeholder = placeholderUser("javier.alayón@ulpgc.es");
    expect(placeholder.Username).toBe("javier.alayón@ulpgc.es");
    expect(placeholder.role).toBe("user");
    expect(placeholder.GDPRConsent).toBe(false);
    expect(placeholder.UUID).toBeNull();
  });
});
