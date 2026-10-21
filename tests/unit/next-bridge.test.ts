import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
} from "@/server/http/cookies";
import {
  runApiRoute,
  toNextResponse,
} from "@/server/http/next/route-bridge";

describe("Next.js response bridge", () => {
  it("serializes the session only as an HttpOnly cookie", () => {
    const response = toNextResponse({
      status: 200,
      body: { method: "email" },
      cookies: [
        buildSessionCookie("opaque-token", "2099-01-01T00:00:00.000Z", true),
      ],
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dashboard_session=opaque-token");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=lax");
    expect(setCookie).toContain("Path=/");
  });

  it("clears the cookie with Max-Age=0", () => {
    const response = toNextResponse({
      status: 204,
      cookies: [buildClearedSessionCookie(false)],
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dashboard_session=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
  });

  it("rejects mutations without Origin or Sec-Fetch-Site", async () => {
    const request = new NextRequest("http://localhost/api/auth/logout", {
      method: "POST",
    });
    const response = await runApiRoute(request, async () => ({
      status: 204,
    }));
    expect(response.status).toBe(403);
  });

  it("allows same-origin mutations through the CSRF gate", async () => {
    const request = new NextRequest("http://localhost/api/auth/logout", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const response = await runApiRoute(request, async () => ({
      status: 204,
      cookies: [buildClearedSessionCookie(false)],
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
