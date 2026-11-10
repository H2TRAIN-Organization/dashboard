import { expect, test, type Page } from "@playwright/test";

/**
 * UI de la vista administrativa de Kubios.
 *
 * Todas las respuestas se interceptan en el navegador: no se contacta Kubios,
 * PostgreSQL ni la API real. Requiere un servidor Next local compartido:
 * PLAYWRIGHT_BASE_URL=http://127.0.0.1:3107 npx playwright test tests/e2e/admin-kubios.spec.ts
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a local Next server to run these UI tests.",
);

type Role = "admin" | "doctor" | "user";

interface Participant {
  userId: number;
  username: string;
}

interface ParticipantsPage {
  cursor: string | null;
  participants: Participant[];
  nextCursor: string | null;
}

type MeasurementStatus = "ready" | "stale";
type PageStatus = "ready" | "stale" | "pending" | "empty" | "unlinked";

interface MeasurementRow {
  userId: number;
  username: string;
  measuredTimestamp: string | null;
  metrics: Record<string, number>;
  syncedAt: string;
  status: MeasurementStatus;
}

interface MeasurementsPageBody {
  measurements: MeasurementRow[];
  nextCursor: string | null;
  status: PageStatus;
  unavailableCount: number;
}

function sessionBody(role: Role, username: string) {
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
    method: "email" as const,
    expiresAt: "2026-12-01T00:00:00.000Z",
  };
}

async function mockSession(page: Page, role: Role = "admin", username = "root") {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: sessionBody(role, username) }),
  );
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
}

async function mockAdminDashboardData(page: Page) {
  await page.route("**/api/users/count", (route) =>
    route.fulfill({ json: { count: 2 } }),
  );
  await page.route("**/api/admin/database/tables", (route) =>
    route.fulfill({
      json: {
        success: true,
        tables: [],
        totalRecords: 0,
        accessibleCount: 0,
        totalCount: 0,
      },
    }),
  );
}

async function mockParticipantPages(
  page: Page,
  pages: ParticipantsPage[],
  options: { failFirst?: boolean } = {},
) {
  let calls = 0;
  await page.route("**/api/admin/kubios/participants*", async (route) => {
    calls += 1;
    if (options.failFirst === true && calls === 1) {
      await route.fulfill({
        status: 500,
        json: {
          error: { code: "SERVER", message: "No se pudieron cargar" },
        },
      });
      return;
    }

    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const batch = pages.find((entry) => entry.cursor === cursor);
    if (batch === undefined) {
      await route.fulfill({
        status: 400,
        json: { error: { code: "BAD_CURSOR", message: "Cursor desconocido" } },
      });
      return;
    }
    await route.fulfill({
      json: { participants: batch.participants, nextCursor: batch.nextCursor },
    });
  });
}

function participantsPage(
  participants: Participant[],
  nextCursor: string | null,
  cursor: string | null = null,
): ParticipantsPage {
  return { cursor, participants, nextCursor };
}

function measurementRow(
  userId: number,
  username: string,
  overrides: Partial<Omit<MeasurementRow, "userId" | "username">> = {},
): MeasurementRow {
  return {
    userId,
    username,
    measuredTimestamp: "2026-11-01T08:30:00Z",
    metrics: {
      readiness: 72,
      mean_hr_bpm: 58,
      rmssd_ms: 44.2,
      pns_index: 1.5,
      sns_index: -0.5,
      physiological_age: 31,
      respiratory_rate: 14.5,
      stress_index: 12,
    },
    syncedAt: "2026-11-03T10:00:00Z",
    status: "ready",
    ...overrides,
  };
}

function measurementsPage(
  measurements: MeasurementRow[],
  options: Partial<Omit<MeasurementsPageBody, "measurements">> = {},
): MeasurementsPageBody {
  return {
    measurements,
    nextCursor: null,
    status: "ready",
    unavailableCount: 0,
    ...options,
  };
}

function trackAdminKubiosRequests(page: Page): URL[] {
  const requests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/admin/kubios/")) {
      requests.push(url);
    }
  });
  return requests;
}

async function openParticipantList(page: Page) {
  const combobox = page.getByPlaceholder("Buscar participante...");
  await combobox.click();
  // Clicking an already-focused combobox does not emit focus again; ArrowDown
  // always opens the list and is part of the keyboard contract.
  await combobox.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  return combobox;
}

async function selectParticipant(page: Page, username: string) {
  const combobox = await openParticipantList(page);
  await combobox.fill(username);
  await page.getByRole("option", { name: username, exact: true }).click();
}

test.describe("Admin Kubios overview", () => {
  test.use({ timezoneId: "UTC" });

  test("the administration page exposes a discoverable Kubios card", async ({
    page,
  }) => {
    await mockSession(page);
    await mockAdminDashboardData(page);
    await mockParticipantPages(page, [
      participantsPage(
        [
          { userId: 1, username: "alice" },
          { userId: 2, username: "bruno" },
        ],
        null,
      ),
    ]);
    await page.route("**/api/admin/kubios/measurements*", (route) =>
      route.fulfill({
        json: measurementsPage([
          measurementRow(1, "alice", { measuredTimestamp: null }),
        ]),
      }),
    );

    await page.goto("/admin");

    const card = page.getByRole("link", { name: /Kubios \(Equipo\)/ });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("href", "/admin/kubios");

    await card.click();

    await expect(page).toHaveURL(/\/admin\/kubios$/);
    await expect(
      page.getByRole("main").getByRole("heading", { name: "Kubios (Equipo)" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("admin-kubios-row").filter({ hasText: "alice" }),
    ).toBeVisible();
  });

  test("loads the global page without userId and renders the numeric metrics", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page);
    const requests = trackAdminKubiosRequests(page);
    await mockParticipantPages(page, [
      participantsPage(
        [
          { userId: 1, username: "alice" },
          { userId: 2, username: "bruno" },
        ],
        null,
      ),
    ]);
    await page.route("**/api/admin/kubios/measurements*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("userId") === null) {
        return route.fulfill({
          json: measurementsPage(
            [
              measurementRow(1, "alice", {
                metrics: {
                  readiness: 72,
                  mean_hr_bpm: 58,
                  rmssd_ms: 44.2,
                  pns_index: 1.5,
                  sns_index: -0.5,
                  physiological_age: 31,
                  respiratory_rate: 14.5,
                  stress_index: 12,
                  HF_power: 1200,
                  LF_power: 800.2,
                  VLF_power: 300,
                  tot_power: 2300.4,
                },
              }),
              measurementRow(2, "bruno", {
                measuredTimestamp: null,
                status: "stale",
                metrics: { readiness: 64, rmssd_ms: 39.1 },
              }),
            ],
            { status: "stale", unavailableCount: 1 },
          ),
        });
      }
      return route.fulfill({ json: measurementsPage([]) });
    });

    await page.goto("/admin/kubios");

    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(2);
    const measurementRequest = requests.find((url) =>
      url.pathname.endsWith("/measurements"),
    );
    expect(measurementRequest).toBeDefined();
    expect(measurementRequest?.searchParams.get("userId")).toBeNull();
    expect(measurementRequest?.searchParams.get("cursor")).toBeNull();

    const aliceRow = page
      .getByTestId("admin-kubios-row")
      .filter({ hasText: "alice" });
    await expect(aliceRow).toContainText("58");
    await expect(aliceRow).toContainText("44.2");
    await expect(aliceRow).toContainText("1.50");
    await expect(aliceRow).toContainText("-0.50");
    await expect(aliceRow).toContainText("31");
    await expect(aliceRow).toContainText("14.5");
    await expect(aliceRow).toContainText("12.0");
    await expect(aliceRow).toContainText("1200.0");
    await expect(aliceRow).toContainText("2300.4");
    await expect(aliceRow).toContainText("nov 2026");
    await expect(aliceRow).toContainText("Actualizado");

    const brunoRow = page
      .getByTestId("admin-kubios-row")
      .filter({ hasText: "bruno" });
    await expect(brunoRow).toContainText("Desactualizado");
    await expect(brunoRow).toContainText("N/D");

    await expect(
      page.getByText(/Algunas mediciones son la última copia sincronizada/i),
    ).toBeVisible();
    const unavailableWarning = page.getByText(
      /Algunos historiales de participantes vinculados no se pudieron leer/i,
    );
    await expect(unavailableWarning).toBeVisible();
    await expect(unavailableWarning).toHaveCount(1);
    await expect(
      page.getByTestId("admin-kubios-page-count"),
    ).toHaveText("2");

    const combobox = await openParticipantList(page);
    await expect(combobox).toHaveValue("");
    await expect(
      page.getByRole("option", { name: "Todos los participantes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "alice", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "bruno", exact: true }),
    ).toBeVisible();
  });

  test("filters at every keystroke across all participant pages and clears", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page);
    const requests = trackAdminKubiosRequests(page);
    await mockParticipantPages(page, [
      participantsPage(
        [
          { userId: 11, username: "Álvaro" },
          { userId: 12, username: "Beatriz" },
        ],
        "cursor-2",
      ),
      participantsPage(
        [
          { userId: 13, username: "Carmen" },
          { userId: 14, username: "Álvaro Ruiz" },
        ],
        null,
        "cursor-2",
      ),
    ]);
    await page.route("**/api/admin/kubios/measurements*", (route) => {
      const url = new URL(route.request().url());
      const userId = url.searchParams.get("userId");
      const rows =
        userId === null
          ? [
              measurementRow(11, "Álvaro"),
              measurementRow(12, "Beatriz"),
              measurementRow(13, "Carmen"),
              measurementRow(14, "Álvaro Ruiz"),
            ]
          : [measurementRow(Number(userId), userId === "14" ? "Álvaro Ruiz" : "Álvaro")];
      return route.fulfill({ json: measurementsPage(rows) });
    });

    await page.goto("/admin/kubios");
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(4);

    const combobox = await openParticipantList(page);
    await combobox.fill("alv");
    await expect(
      page.getByRole("option", { name: "Álvaro", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Álvaro Ruiz", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Beatriz", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("option", { name: "Carmen", exact: true }),
    ).toHaveCount(0);

    await combobox.fill("alvaro r");
    await expect(
      page.getByRole("option", { name: "Álvaro Ruiz", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Álvaro", exact: true }),
    ).toHaveCount(0);

    const selectedRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/api/admin/kubios/measurements") &&
        url.searchParams.get("userId") === "14"
      );
    });
    await page
      .getByRole("option", { name: "Álvaro Ruiz", exact: true })
      .click();
    await selectedRequest;

    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(1);
    await expect(page.getByTestId("admin-kubios-row")).toContainText(
      "Álvaro Ruiz",
    );
    await expect(page.getByTestId("admin-kubios-row")).not.toContainText(
      "Beatriz",
    );
    await expect(combobox).toHaveValue("Álvaro Ruiz");

    const globalRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/api/admin/kubios/measurements") &&
        url.searchParams.get("userId") === null &&
        url.searchParams.get("cursor") === null
      );
    });
    await page.getByRole("button", { name: "Quitar selección" }).click();
    await globalRequest;

    await expect(combobox).toHaveValue("");
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(4);
    const lastMeasurementRequest = requests
      .filter((url) => url.pathname.endsWith("/measurements"))
      .at(-1);
    expect(lastMeasurementRequest?.searchParams.get("userId")).toBeNull();
  });

  test("supports keyboard navigation and a scrollable partial list", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page);
    const participants = Array.from({ length: 40 }, (_, index) => ({
      userId: index + 1,
      username: `user-${index + 1}`,
    }));
    await mockParticipantPages(page, [participantsPage(participants, null)]);
    await page.route("**/api/admin/kubios/measurements*", (route) => {
      const url = new URL(route.request().url());
      const userId = url.searchParams.get("userId");
      return route.fulfill({
        json: measurementsPage([
          measurementRow(
            userId === null ? 1 : Number(userId),
            userId === null ? "global" : `user-${userId}`,
          ),
        ]),
      });
    });

    await page.goto("/admin/kubios");

    const combobox = await openParticipantList(page);
    const listbox = page.getByRole("listbox");
    const sizes = await listbox.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(sizes.clientHeight).toBeLessThan(sizes.scrollHeight);
    expect(sizes.clientHeight).toBeLessThanOrEqual(320);

    await combobox.press("End");
    await expect
      .poll(() => listbox.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    const lastRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/api/admin/kubios/measurements") &&
        url.searchParams.get("userId") === "40"
      );
    });
    await combobox.press("Enter");
    await lastRequest;
    await expect(combobox).toHaveValue("user-40");

    await page.getByRole("button", { name: "Quitar selección" }).click();
    await expect(combobox).toHaveValue("");
    await combobox.click();
    await expect(page.getByRole("listbox")).toBeVisible();

    const firstRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/api/admin/kubios/measurements") &&
        url.searchParams.get("userId") === "1"
      );
    });
    await combobox.press("ArrowDown");
    await combobox.press("ArrowDown");
    await combobox.press("Enter");
    await firstRequest;
    await expect(combobox).toHaveValue("user-1");

    await combobox.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await combobox.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });

  test("hides the previous participant page immediately and discards stale selections", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSession(page);
    await mockParticipantPages(page, [
      participantsPage(
        [
          { userId: 1, username: "alice" },
          { userId: 2, username: "bob" },
        ],
        null,
      ),
    ]);

    let releaseAlice!: () => void;
    const aliceGate = new Promise<void>((resolve) => {
      releaseAlice = resolve;
    });

    await page.route("**/api/admin/kubios/measurements*", async (route) => {
      const url = new URL(route.request().url());
      const userId = url.searchParams.get("userId");
      try {
        if (userId === "1") {
          await aliceGate;
          await route.fulfill({
            json: measurementsPage([measurementRow(1, "alice")]),
          });
          return;
        }
        if (userId === "2") {
          await route.fulfill({
            json: measurementsPage([measurementRow(2, "bob")]),
          });
          return;
        }
        await route.fulfill({
          json: measurementsPage([measurementRow(0, "global")]),
        });
      } catch {
        // The client aborts superseded requests; the route may already be gone.
      }
    });

    await page.goto("/admin/kubios");
    await expect(page.getByTestId("admin-kubios-row")).toContainText("global");

    await selectParticipant(page, "alice");

    // Mientras la respuesta de alice está retenida, la página global anterior
    // ya no puede mostrarse con la selección nueva.
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(0);
    await expect(page.getByText("Cargando...")).toBeVisible();

    await selectParticipant(page, "bob");
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(1);
    await expect(page.getByTestId("admin-kubios-row")).toContainText("bob");
    const combobox = page.getByPlaceholder("Buscar participante...");
    await expect(combobox).toHaveValue("bob");

    releaseAlice();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(1);
    await expect(page.getByTestId("admin-kubios-row")).toContainText("bob");
    await expect(page.getByTestId("admin-kubios-row")).not.toContainText(
      "alice",
    );
    await expect(combobox).toHaveValue("bob");
  });

  test("does not apply an in-flight measurement response after logout", async ({
    page,
  }) => {
    await mockSession(page);
    await mockParticipantPages(page, [
      participantsPage([{ userId: 1, username: "alice" }], null),
    ]);

    let releaseAlice!: () => void;
    const aliceGate = new Promise<void>((resolve) => {
      releaseAlice = resolve;
    });

    await page.route("**/api/admin/kubios/measurements*", async (route) => {
      const userId = new URL(route.request().url()).searchParams.get("userId");
      try {
        if (userId === "1") {
          await aliceGate;
          await route.fulfill({
            json: measurementsPage([measurementRow(1, "alice")]),
          });
          return;
        }
        await route.fulfill({
          json: measurementsPage([measurementRow(0, "global")]),
        });
      } catch {
        // The request can be aborted by the logout-driven unmount.
      }
    });

    await page.goto("/admin/kubios");
    await expect(page.getByTestId("admin-kubios-row")).toContainText("global");

    await selectParticipant(page, "alice");
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(0);

    await page.getByRole("button", { name: /Cerrar sesión/i }).click();
    await page.waitForURL((url) => url.pathname === "/login");

    releaseAlice();
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(0);
  });

  test("restarts at the first page when the server answers 409", async ({
    page,
  }) => {
    await mockSession(page);
    const requests = trackAdminKubiosRequests(page);
    await mockParticipantPages(page, [
      participantsPage([{ userId: 1, username: "alice" }], null),
    ]);
    await page.route("**/api/admin/kubios/measurements*", (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === null) {
        return route.fulfill({
          json: measurementsPage([measurementRow(1, "alice")], {
            nextCursor: "cursor-1",
          }),
        });
      }
      if (cursor === "cursor-1") {
        return route.fulfill({
          json: measurementsPage([], {
            nextCursor: "cursor-2",
            unavailableCount: 1,
          }),
        });
      }
      return route.fulfill({
        status: 409,
        json: {
          error: { code: "CURSOR_EXPIRED", message: "Cursor caducado" },
        },
      });
    });

    await page.goto("/admin/kubios");
    await expect(page.getByTestId("admin-kubios-row")).toContainText("alice");

    const sparseRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/api/admin/kubios/measurements") &&
        url.searchParams.get("cursor") === "cursor-1"
      );
    });
    const expiredRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/api/admin/kubios/measurements") &&
        url.searchParams.get("cursor") === "cursor-2"
      );
    });
    const restartedRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/api/admin/kubios/measurements") &&
        url.searchParams.get("cursor") === null &&
        url.searchParams.get("userId") === null
      );
    });

    await page.getByRole("button", { name: "Siguiente" }).click();
    await sparseRequest;
    await expiredRequest;
    await restartedRequest;

    await expect(page.getByTestId("admin-kubios-row")).toContainText("alice");
    await expect(page.getByText("Página 1")).toBeVisible();
    await expect(
      page.getByText(
        /Algunos historiales de participantes vinculados no se pudieron leer/i,
      ),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Anterior" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Siguiente" })).toBeEnabled();

    await expect
      .poll(
        () =>
          requests
            .filter((url) => url.pathname.endsWith("/measurements"))
            .map((url) => url.searchParams.get("cursor")),
      )
      .toEqual([null, "cursor-1", "cursor-2", null]);
  });

  test("pages through sparse cursor batches and keeps cursor history", async ({
    page,
  }) => {
    await mockSession(page);
    const requests = trackAdminKubiosRequests(page);
    await mockParticipantPages(page, [
      participantsPage([{ userId: 1, username: "alice" }], null),
    ]);
    await page.route("**/api/admin/kubios/measurements*", (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === null) {
        return route.fulfill({
          json: measurementsPage([measurementRow(1, "page-one")], {
            nextCursor: "cursor-1",
          }),
        });
      }
      if (cursor === "cursor-1") {
        return route.fulfill({
          json: measurementsPage([], {
            nextCursor: "cursor-2",
            unavailableCount: 1,
          }),
        });
      }
      if (cursor === "cursor-2") {
        return route.fulfill({
          json: measurementsPage([measurementRow(2, "page-two")]),
        });
      }
      return route.fulfill({
        status: 400,
        json: { error: { code: "BAD_CURSOR", message: "Cursor desconocido" } },
      });
    });

    await page.goto("/admin/kubios");
    await expect(page.getByTestId("admin-kubios-row")).toContainText(
      "page-one",
    );
    await expect(
      page.getByText(
        /Algunos historiales de participantes vinculados no se pudieron leer/i,
      ),
    ).toHaveCount(0);

    const sparseRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.endsWith("/api/admin/kubios/measurements") &&
        url.searchParams.get("cursor") !== null
      ) {
        sparseRequests.push(url.searchParams.get("cursor") ?? "");
      }
    });

    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(page.getByTestId("admin-kubios-row")).toContainText(
      "page-two",
    );
    expect(sparseRequests).toEqual(["cursor-1", "cursor-2"]);
    await expect(page.getByText("Página 2")).toBeVisible();
    await expect(
      page.getByText(
        /Algunos historiales de participantes vinculados no se pudieron leer/i,
      ),
    ).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Siguiente" })).toBeDisabled();

    await page.getByRole("button", { name: "Anterior" }).click();
    await expect(page.getByTestId("admin-kubios-row")).toContainText(
      "page-one",
    );
    await expect(page.getByText("Página 1")).toBeVisible();
    await expect(
      page.getByText(
        /Algunos historiales de participantes vinculados no se pudieron leer/i,
      ),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Anterior" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Siguiente" })).toBeEnabled();

    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(page.getByTestId("admin-kubios-row")).toContainText(
      "page-two",
    );

    const measuredCursors = requests
      .filter((url) => url.pathname.endsWith("/measurements"))
      .map((url) => url.searchParams.get("cursor"));
    expect(measuredCursors).toEqual([
      null,
      "cursor-1",
      "cursor-2",
      null,
      "cursor-1",
      "cursor-2",
    ]);
  });

  test("renders unlinked, pending and empty statuses honestly", async ({
    page,
  }) => {
    await mockSession(page);
    await mockParticipantPages(page, [
      participantsPage(
        [
          { userId: 1, username: "alice" },
          { userId: 2, username: "bob" },
        ],
        null,
      ),
    ]);
    await page.route("**/api/admin/kubios/measurements*", (route) => {
      const userId = new URL(route.request().url()).searchParams.get("userId");
      if (userId === "1") {
        return route.fulfill({
          json: measurementsPage([], { status: "pending" }),
        });
      }
      if (userId === "2") {
        return route.fulfill({
          json: measurementsPage([], { status: "empty" }),
        });
      }
      return route.fulfill({
        json: measurementsPage([], { status: "unlinked" }),
      });
    });

    await page.goto("/admin/kubios");

    await expect(
      page.getByText(/Hay participantes sin vincular a Kubios/i),
    ).toBeVisible();
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(0);

    await selectParticipant(page, "alice");
    await expect(
      page.getByText(/La sincronización de Kubios está pendiente/i),
    ).toBeVisible();
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(0);

    await selectParticipant(page, "bob");
    await expect(
      page.getByText(/No hay mediciones Kubios para la selección actual/i),
    ).toBeVisible();
    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(0);
  });

  test("shows unavailable participant histories when the page has no measurements", async ({
    page,
  }) => {
    await mockSession(page);
    await mockParticipantPages(page, [
      participantsPage([{ userId: 1, username: "alice" }], null),
    ]);
    await page.route("**/api/admin/kubios/measurements*", (route) =>
      route.fulfill({
        json: measurementsPage([], {
          status: "empty",
          unavailableCount: 3,
        }),
      }),
    );

    await page.goto("/admin/kubios");

    await expect(page.getByTestId("admin-kubios-row")).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByText(/No hay mediciones Kubios para la selección actual/i),
    ).toHaveCount(0);
    const warning = page.getByText(
      /Algunos historiales de participantes vinculados no se pudieron leer/i,
    );
    await expect(warning).toBeVisible();
    await expect(warning).toHaveCount(1);
  });

  test("shows a measurement error and recovers on retry", async ({ page }) => {
    await mockSession(page);
    await mockParticipantPages(page, [
      participantsPage([{ userId: 1, username: "alice" }], null),
    ]);
    let calls = 0;
    await page.route("**/api/admin/kubios/measurements*", (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({
          status: 500,
          json: {
            error: { code: "SERVER", message: "No se pudieron cargar" },
          },
        });
      }
      return route.fulfill({
        json: measurementsPage([measurementRow(1, "alice")]),
      });
    });

    await page.goto("/admin/kubios");

    await expect(
      page.getByText("No se pudieron cargar las mediciones de Kubios."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByTestId("admin-kubios-row")).toContainText("alice");
  });

  test("shows a participant error and recovers on retry", async ({ page }) => {
    await mockSession(page);
    await mockParticipantPages(
      page,
      [
        participantsPage([{ userId: 1, username: "alice" }], null),
      ],
      { failFirst: true },
    );
    await page.route("**/api/admin/kubios/measurements*", (route) =>
      route.fulfill({
        json: measurementsPage([measurementRow(1, "alice")]),
      }),
    );

    await page.goto("/admin/kubios");

    await expect(
      page.getByText("No se pudieron cargar los participantes."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reintentar participantes" })
      .click();

    const combobox = await openParticipantList(page);
    await expect(
      page.getByRole("option", { name: "alice", exact: true }),
    ).toBeVisible();
    await expect(combobox).toHaveValue("");
  });

  test("does not render or request admin Kubios data for a non-admin role", async ({
    page,
  }) => {
    await mockSession(page, "doctor", "doctor-1");
    const requests = trackAdminKubiosRequests(page);

    await page.goto("/admin/kubios");
    await page.waitForURL((url) => url.pathname === "/");
    await page.waitForTimeout(300);

    expect(requests).toHaveLength(0);
    await expect(page.getByText("Kubios (Equipo)")).toHaveCount(0);
  });

  test("requires a session before requesting admin Kubios data", async ({
    page,
  }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        status: 401,
        json: { error: { code: "UNAUTHORIZED", message: "Sin sesión" } },
      }),
    );
    const requests = trackAdminKubiosRequests(page);

    await page.goto("/admin/kubios");
    await page.waitForURL((url) => url.pathname === "/login");
    await page.waitForTimeout(300);

    expect(requests).toHaveLength(0);
  });

  test("keeps the table usable on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSession(page);
    await mockParticipantPages(page, [
      participantsPage([{ userId: 1, username: "alice" }], null),
    ]);
    await page.route("**/api/admin/kubios/measurements*", (route) =>
      route.fulfill({
        json: measurementsPage([measurementRow(1, "alice")]),
      }),
    );

    await page.goto("/admin/kubios");

    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(page.getByTestId("admin-kubios-row")).toContainText("alice");
    const scroller = await table.evaluate((element) => {
      const parent = element.parentElement;
      return {
        clientWidth: parent?.clientWidth ?? 0,
        scrollWidth: parent?.scrollWidth ?? 0,
      };
    });
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
  });
});
