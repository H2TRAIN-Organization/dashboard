/**
 * Pure helpers shared by the Health Data and Users Management screens.
 *
 * Keeping pagination and empty-metric decisions here makes them testable
 * without a browser and keeps both the table and the mobile cards fed by the
 * same page of users (DR18).
 */

import type { User } from './api-types'

export const USERS_PAGE_SIZES = [10, 25, 50] as const

export type UsersPageSize = (typeof USERS_PAGE_SIZES)[number]

export const DEFAULT_USERS_PAGE_SIZE: UsersPageSize = 25

export function isUsersPageSize(value: number): value is UsersPageSize {
  return value === 10 || value === 25 || value === 50
}

function safePageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return DEFAULT_USERS_PAGE_SIZE
  }
  return Math.floor(pageSize)
}

function safeTotal(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.floor(total)
}

export function usersTotalPages(total: number, pageSize: number): number {
  const size = safePageSize(pageSize)
  return Math.max(1, Math.ceil(safeTotal(total) / size))
}

/**
 * A page always exists (page 1) even when the filtered total is zero, so the
 * controls stay usable after deleting the last row of the last page.
 */
export function clampUsersPage(
  page: number,
  total: number,
  pageSize: number,
): number {
  const lastPage = usersTotalPages(total, pageSize)
  const value = Number.isFinite(page) ? Math.floor(page) : 1
  return Math.min(Math.max(value, 1), lastPage)
}

export function usersOffset(page: number, pageSize: number): number {
  const size = safePageSize(pageSize)
  const value = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1
  return (value - 1) * size
}

export interface UsersRange {
  /** 1-based index of the first row on the page, 0 when the page is empty. */
  from: number
  /** 1-based index of the last row on the page, 0 when the page is empty. */
  to: number
}

export function usersRange(
  total: number,
  page: number,
  pageSize: number,
): UsersRange {
  const size = safePageSize(pageSize)
  const count = safeTotal(total)
  if (count === 0) return { from: 0, to: 0 }
  const current = clampUsersPage(page, count, size)
  const from = (current - 1) * size + 1
  return { from, to: Math.min(count, from + size - 1) }
}

/**
 * Metric cards are rendered only after loading finished and only when they
 * have records (DR12). This helper never rewrites the values themselves: a
 * record with `mood_value: 0` or `out_of_routine: false` is still a record and
 * its card must stay visible.
 */
export function visibleMetricCards<T extends { count: number }>(
  cards: readonly T[],
): T[] {
  return cards.filter(
    (card) => Number.isFinite(card.count) && card.count > 0,
  )
}

/**
 * Individual users see their categories and records directly; privileged
 * roles keep the explicit expand/collapse interaction (DR08).
 */
export function isUserGroupExpanded(
  isIndividualUser: boolean,
  userId: string,
  expandedUsers: ReadonlySet<string>,
): boolean {
  return isIndividualUser || expandedUsers.has(userId)
}

/**
 * Returns the page to load after a successful deletion. Deleting the last row
 * of the last page must move the view back one page instead of showing an
 * empty table.
 */
export function pageAfterDeletion(
  page: number,
  totalBefore: number,
  pageSize: number,
): number {
  const remaining = Math.max(0, safeTotal(totalBefore) - 1)
  return clampUsersPage(page, remaining, pageSize)
}

/**
 * Records can reference a username that the user listing did not include (for
 * example a truncated or failed listing). Grouping by the records themselves
 * keeps every authorized record visible, which is what DR07/DR08 require.
 */
export function placeholderUser(username: string): User {
  return {
    UserID: `username:${username}`,
    Username: username,
    Email: null,
    UUID: null,
    GDPRConsent: false,
    GDPRConsentDate: null,
    role: 'user',
    createdAt: null,
  }
}

export function usersForRecordGroups(
  users: readonly User[],
  recordUsernames: readonly string[],
): User[] {
  const known = new Set(users.map((user) => user.Username))
  const extra: string[] = []
  for (const username of recordUsernames) {
    const trimmed = username.trim()
    if (trimmed.length === 0) continue
    if (known.has(trimmed)) continue
    known.add(trimmed)
    extra.push(trimmed)
  }
  return [...users, ...extra.map(placeholderUser)]
}
