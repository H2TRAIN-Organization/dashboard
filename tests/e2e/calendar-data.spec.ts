import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser contract for the shared Health Data calendar.
 *
 * These tests run only against an explicitly provided base URL so a normal
 * `npm run test:e2e` never starts or contacts a real deployment. The API is
 * mocked at the browser boundary; no database or real credentials are used.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const USERS = [
  {
    id: "1",
    username: "root",
    email: null,
    role: "admin",
    uuid: null,
    gdprConsent: false,
    gdprConsentAt: null,
    createdAt: null,
  },
];

function sessionBody() {
  return {
    user: {
      id: "1",
      username: "root",
      email: null,
      role: "admin",
      uuid: null,
      gdprConsent: false,
      gdprConsentAt: null,
      createdAt: null,
    },
    method: "username" as const,
    expiresAt: "2026-12-01T00:00:00.000Z",
  };
}

async function mockSession(page: Page) {
  await page.route("**/api/kubios/**", (route) =>
    route.fulfill({
      json: {
        status: "empty",
        measurement_count: 0,
        synced_at: null,
        latest_result: null,
        results: [],
      },
    }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: sessionBody() }),
  );
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
}

async function mockUsersApi(page: Page) {
  await page.route(/\/api\/users(\?.*)?$/, (route: Route) =>
    route.fulfill({ json: { users: USERS, total: USERS.length } }),
  );
}

async function mockEmptyHealthData(page: Page) {
  await page.route("**/api/decrypted-data**", (route) =>
    route.fulfill({
      json: {
        insulinData: [],
        foodData: [],
        exerciseData: [],
        periodData: [],
        moodData: [],
      },
    }),
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addMonthsClamped(date: Date, amount: number) {
  const targetMonth = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const daysInTarget = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0,
  ).getDate();
  return new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth(),
    Math.min(date.getDate(), daysInTarget),
  );
}

function monthHeading(date: Date) {
  const month = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(date);
  const capitalized = month.charAt(0).toLocaleUpperCase("es-ES") + month.slice(1);
  return `${capitalized} ${date.getFullYear()}`;
}

function waitForDateRequest(page: Page, dateValue: string) {
  return page.waitForRequest((request) => {
    if (!request.url().includes("/api/decrypted-data")) return false;
    const url = new URL(request.url());
    return url.searchParams.get("dateFilter") === dateValue;
  });
}

test.describe("Health Data calendar", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page);
    await mockUsersApi(page);
    await mockEmptyHealthData(page);
  });

  test("opens an accessible grid and selects today with the keyboard", async ({
    page,
  }) => {
    await page.goto("/data");

    const trigger = page.locator("#health-data-date-trigger");
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Fecha Específica" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("grid")).toBeVisible();
    await expect(
      dialog.getByRole("columnheader", { name: "domingo" }),
    ).toBeVisible();

    const todayValue = localDateValue(new Date());
    const todayButton = dialog.locator(`[data-date="${todayValue}"]`);
    await expect(todayButton).toHaveAttribute("aria-current", "date");
    await expect(todayButton).toBeFocused();

    // Arrow navigation uses roving focus and Escape restores the trigger.
    await page.keyboard.press("ArrowRight");
    await expect(
      dialog.locator(`[data-date="${localDateValue(addDays(new Date(), 1))}"]`),
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(todayButton).toBeFocused();

    const request = waitForDateRequest(page, todayValue);
    await page.keyboard.press("Enter");
    await request;

    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).not.toContainText("Seleccionar fecha");

    // The footer Today action keeps the previous Health Data behaviour: it
    // selects the current day and closes the calendar.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Hoy" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("previous and next update the filter without closing the dialog", async ({
    page,
  }) => {
    await page.goto("/data");

    const trigger = page.locator("#health-data-date-trigger");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Fecha Específica" });
    await expect(dialog).toBeVisible();

    const today = new Date();
    const nextMonth = addMonthsClamped(today, 1);

    const nextRequest = waitForDateRequest(page, localDateValue(nextMonth));
    await dialog.getByRole("button", { name: "Siguiente" }).click();
    await nextRequest;
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h3")).toHaveText(monthHeading(nextMonth));

    const previousRequest = waitForDateRequest(page, localDateValue(today));
    await dialog.getByRole("button", { name: "Anterior" }).click();
    await previousRequest;
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h3")).toHaveText(monthHeading(today));
  });

  test("selects a date-only value and clear filters resets it", async ({
    page,
  }) => {
    await page.goto("/data");

    const trigger = page.locator("#health-data-date-trigger");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Fecha Específica" });
    await expect(dialog).toBeVisible();

    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), 15);
    const targetValue = localDateValue(target);

    const request = waitForDateRequest(page, targetValue);
    await dialog.locator(`[data-date="${targetValue}"]`).click();
    await request;

    await expect(dialog).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).not.toContainText("Seleccionar fecha");
    await expect(trigger).toContainText(String(now.getFullYear()));

    const clearedRequest = page.waitForRequest((cleared) => {
      if (!cleared.url().includes("/api/decrypted-data")) return false;
      return !new URL(cleared.url()).searchParams.has("dateFilter");
    });
    await page.getByRole("button", { name: /Limpiar filtros/ }).click();
    await clearedRequest;

    await expect(trigger).toContainText("Seleccionar fecha");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps the mobile dialog inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/data");

    await page.locator("#health-data-date-trigger").click();
    const dialog = page.getByRole("dialog", { name: "Fecha Específica" });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);

    await expect(dialog.getByRole("button", { name: "Hoy" })).toBeVisible();
    await expect(dialog.getByRole("grid")).toBeVisible();
  });
});
