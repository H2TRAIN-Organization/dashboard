import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * UI contract for DR08/DR09/DR10/DR11/DR18/DR19.
 *
 * These tests run only against an explicitly provided base URL so a normal
 * `npm run test:e2e` never starts or contacts a real deployment. The API is
 * mocked at the browser boundary; no database or session cookie is needed.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const USERS = Array.from({ length: 31 }, (_, index) => {
  const id = String(index + 1);
  return {
    id,
    username: index === 0 ? "root" : `member-${id}`,
    email: null,
    role: index === 0 ? "admin" : "user",
    uuid: index % 3 === 0 ? null : `uuid-${id}`,
    gdprConsent: index % 2 === 0,
    gdprConsentAt: null,
    createdAt: null,
  };
});

function sessionBody(role: "admin" | "user", username: string) {
  return {
    user: {
      id: role === "admin" ? "1" : "2",
      username,
      email: null,
      role,
      uuid: null,
      gdprConsent: false,
      gdprConsentAt: null,
      createdAt: null,
    },
    method: "username" as const,
    expiresAt: "2026-12-01T00:00:00.000Z",
    privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
  };
}

async function mockSession(
  page: Page,
  role: "admin" | "user",
  username: string,
) {
  await page.route('**/api/kubios/**', (route) =>
    route.fulfill({ json: { status: 'empty', measurement_count: 0, synced_at: null, latest_result: null, results: [] } }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: sessionBody(role, username) }),
  );
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
}

async function mockUsersApi(page: Page) {
  await page.route(/\/api\/users(\?.*)?$/, (route: Route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase();
    const pageParam = url.searchParams.get("page");
    const pageSizeParam = url.searchParams.get("pageSize");
    const filtered = USERS.filter((user) =>
      user.username.toLocaleLowerCase().includes(search),
    );

    if (pageParam === null) {
      // usersApi.listAll() keeps using the limit/offset aliases.
      return route.fulfill({ json: { users: filtered, total: filtered.length } });
    }

    const pageNumber = Number(pageParam) || 1;
    const pageSize = Number(pageSizeParam) || 25;
    const offset = (pageNumber - 1) * pageSize;
    return route.fulfill({
      json: {
        users: filtered.slice(offset, offset + pageSize),
        total: filtered.length,
      },
    });
  });
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

function healthPayload(insulinData: Array<Record<string, unknown>> = []) {
  return {
    insulinData,
    foodData: [],
    exerciseData: [],
    periodData: [],
    moodData: [],
  };
}

function insulinRecord(id: string, username: string) {
  return {
    id,
    username,
    insulinType: "Rápida",
    dose: "1",
    date_time: "2026-01-02T03:04:05.000Z",
    actualDateTime: "2026-01-02T03:04:05.000Z",
  };
}

async function selectUser(page: Page, username: string) {
  const combobox = page.getByPlaceholder("Buscar usuario...");
  await combobox.click();
  await combobox.fill(username);
  await page.getByRole("option", { name: username, exact: true }).click();
}

async function fulfillAfterDelay(route: Route, delay: number, json: unknown) {
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  try {
    await route.fulfill({ json });
  } catch {
    // A superseded request may already be aborted by the client.
  }
}

test.describe("Health Data user view", () => {
  test("shows the individual user's categories without expanding a user", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page, "user", "member-2");
    await mockUsersApi(page);
    await page.route("**/api/decrypted-data**", (route) =>
      route.fulfill({
        json: {
          insulinData: [
            {
              id: "ins-1",
              username: "member-2",
              insulinType: "Rápida",
              dose: "0",
              date_time: "2026-01-02T03:04:05.000Z",
              actualDateTime: "2026-01-02T03:04:05.000Z",
            },
          ],
          foodData: [],
          exerciseData: [],
          periodData: [],
          moodData: [],
        },
      }),
    );

    await page.goto("/data");

    await expect(
      page.getByRole("heading", { name: /Datos de Insulina/i }),
    ).toBeVisible();
    await expect(page.getByText("Rápida")).toBeVisible();
    // The general search was retired (DR10).
    await expect(page.getByPlaceholder("Buscar en datos...")).toHaveCount(0);
    // A regular user has no administrative user autocomplete.
    await expect(page.getByPlaceholder("Buscar usuario...")).toHaveCount(0);
    // Individual users do not get the redundant collapse control (DR08).
    await expect(
      page.getByRole("button", { name: /Mostrar menos/i }),
    ).toHaveCount(0);
  });

  test("administrative filters use an accessible user autocomplete", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page, "admin", "root");
    await mockUsersApi(page);
    await mockEmptyHealthData(page);

    await page.goto("/data");

    const combobox = page.getByPlaceholder("Buscar usuario...");
    await combobox.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await combobox.fill("member-2");
    await expect(
      page.getByRole("option", { name: "member-2", exact: true }),
    ).toBeVisible();

    const selectedRequest = page.waitForRequest((request) =>
      request.url().includes("/api/decrypted-data") &&
      request.url().includes("selectedUser=member-2"),
    );
    // Keyboard selection: first ArrowDown is "all users", second is member-2.
    await combobox.press("ArrowDown");
    await combobox.press("ArrowDown");
    await combobox.press("Enter");
    await selectedRequest;

    await expect(page.getByRole("button", { name: /Quitar selección/i })).toBeVisible();
    await page.getByRole("button", { name: /Quitar selección/i }).click();
    await expect(combobox).toHaveValue("");
  });
});

test.describe("Users Management pagination", () => {
  test("paginates, resets filters and shows the filtered total", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page, "admin", "root");
    await mockUsersApi(page);
    await page.goto("/users");

    await expect(page.getByText("1 / 2")).toBeVisible();
    await expect(page.getByText("1-25 / 31")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(26);

    const secondPageRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/users" &&
        url.searchParams.get("page") === "2" &&
        url.searchParams.get("pageSize") === "25"
      );
    });
    await page.getByRole("button", { name: "Siguiente" }).click();
    await secondPageRequest;
    await expect(page.getByText("26-31 / 31")).toBeVisible();

    const resizedRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/users" &&
        url.searchParams.get("pageSize") === "10" &&
        url.searchParams.get("page") === "1"
      );
    });
    await page.getByLabel("Filas por página").selectOption("10");
    await resizedRequest;
    await expect(page.getByText("1 / 4")).toBeVisible();

    const searchRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/users" &&
        url.searchParams.get("search") === "member-3" &&
        url.searchParams.get("page") === "1"
      );
    });
    await page.getByPlaceholder("Buscar usuarios...").fill("member-3");
    await searchRequest;
    await expect(page.getByText("1 / 1")).toBeVisible();
    await expect(page.getByText("1-3 / 3")).toBeVisible();
  });

  test("keeps the same page in the mobile cards", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSession(page, "admin", "root");
    await mockUsersApi(page);
    await page.goto("/users");

    await expect(page.getByText("1-25 / 31")).toBeVisible();
    await expect(page.getByRole('heading', { name: 'member-2', exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Siguiente" })).toBeEnabled();
  });
});

test.describe("shared language selector", () => {
  test("shows only one visible language button at desktop width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSession(page, "admin", "root");
    await mockUsersApi(page);
    await mockEmptyHealthData(page);

    await page.goto("/data");

    await expect(page.getByTestId("global-language-selector")).toBeVisible();
    await expect(
      page.locator('button[aria-label="Idioma"]:visible'),
    ).toHaveCount(1);
  });
});

test.describe("Health Data request ordering", () => {
  test("keeps the latest filter when a slower earlier response arrives late", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page, "admin", "root");
    await mockUsersApi(page);
    await page.route("**/api/decrypted-data**", async (route) => {
      const selected =
        new URL(route.request().url()).searchParams.get("selectedUser") ??
        "all";
      if (selected === "member-2") {
        await fulfillAfterDelay(
          route,
          700,
          healthPayload([insulinRecord("slow-member-2", "member-2")]),
        );
        return;
      }
      if (selected === "member-3") {
        await fulfillAfterDelay(
          route,
          50,
          healthPayload([insulinRecord("fast-member-3", "member-3")]),
        );
        return;
      }
      await route.fulfill({ json: healthPayload() });
    });

    await page.goto("/data");

    const slowRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/decrypted-data") &&
        request.url().includes("selectedUser=member-2"),
    );
    await selectUser(page, "member-2");
    await slowRequest;

    const fastRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/decrypted-data") &&
        request.url().includes("selectedUser=member-3"),
    );
    await selectUser(page, "member-3");
    await fastRequest;

    await expect(
      page.getByRole("heading", { name: "member-3", exact: true }),
    ).toBeVisible();

    // The member-2 response is released after member-3 was rendered. It must
    // not overwrite the selected account's data.
    await expect(
      page.getByRole("heading", { name: "member-2", exact: true }),
    ).toHaveCount(0);
    await page.waitForTimeout(900);
    await expect(
      page.getByRole("heading", { name: "member-3", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "member-2", exact: true }),
    ).toHaveCount(0);
  });

  test("does not keep the previous account data while a new account loads", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page, "admin", "root");
    await mockUsersApi(page);
    await page.route("**/api/decrypted-data**", async (route) => {
      const selected =
        new URL(route.request().url()).searchParams.get("selectedUser") ??
        "all";
      if (selected === "member-2") {
        await route.fulfill({
          json: healthPayload([insulinRecord("member-2-record", "member-2")]),
        });
        return;
      }
      if (selected === "member-3") {
        await fulfillAfterDelay(
          route,
          800,
          healthPayload([insulinRecord("member-3-record", "member-3")]),
        );
        return;
      }
      await route.fulfill({ json: healthPayload() });
    });

    await page.goto("/data");
    await selectUser(page, "member-2");
    await expect(
      page.getByRole("heading", { name: "member-2", exact: true }),
    ).toBeVisible();

    const nextAccountRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/decrypted-data") &&
        request.url().includes("selectedUser=member-3"),
    );
    await selectUser(page, "member-3");
    await nextAccountRequest;

    // While the new account is loading, the previous account's view is gone.
    await expect(page.getByText("Cargando datos...", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "member-2", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "member-3", exact: true }),
    ).toBeVisible();
  });
});
