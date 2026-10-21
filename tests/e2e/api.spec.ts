import { expect, test } from "@playwright/test";

/**
 * These tests require the new API handlers to be mounted and a disposable test
 * database. They are skipped unless PLAYWRIGHT_BASE_URL is explicitly set so a
 * normal test run never starts or contacts a service.
 */
test.describe("API foundation", () => {
  test.skip(
    process.env.PLAYWRIGHT_BASE_URL === undefined,
    "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run API E2E tests.",
  );

  test("session without a bearer token returns 401", async ({ request }) => {
    const response = await request.get("/api/auth/session");
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toContain("Bearer");
  });

  test("login rejects an empty contract body without echoing secrets", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/login", {
      data: { password: "" },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("password");
  });
});
