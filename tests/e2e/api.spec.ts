import { expect, test } from "@playwright/test";

/**
 * These tests require the new API handlers to be mounted, a disposable test
 * database and a registered server runtime. They are skipped unless
 * PLAYWRIGHT_BASE_URL is explicitly set so a normal test run never starts or
 * contacts a service.
 */
test.describe("API foundation", () => {
  test.skip(
    process.env.PLAYWRIGHT_BASE_URL === undefined,
    "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run API E2E tests.",
  );

  test("session without a cookie returns 401 without a bearer challenge", async ({
    request,
  }) => {
    const response = await request.get("/api/auth/session");
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toBeUndefined();
  });

  test("login validates CSRF headers and does not echo secrets", async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:3000").origin;
    const response = await request.post("/api/auth/login", {
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" },
      data: { password: "" },
    });
    expect(response.status()).toBe(400);
    const body = await response.text();
    expect(body).not.toContain("password");
    expect(body).not.toContain("token");
  });

  test("mutations without Origin or Sec-Fetch-Site are rejected", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/logout");
    expect(response.status()).toBe(403);
  });
});
