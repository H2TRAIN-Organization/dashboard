import { describe, expect, it } from "vitest";
import { assertCsrfSafe } from "@/server/http/security";

const base = {
  requestOrigin: "https://dashboard.example.com",
  allowedOrigins: ["https://admin.example.com"],
};

describe("CSRF origin policy", () => {
  it("does not block safe methods", () => {
    expect(() =>
      assertCsrfSafe({ ...base, method: "GET", origin: null, secFetchSite: "cross-site" }),
    ).not.toThrow();
  });

  it("accepts same-origin mutations with Origin", () => {
    expect(() =>
      assertCsrfSafe({
        ...base,
        method: "POST",
        origin: "https://dashboard.example.com",
        secFetchSite: "same-origin",
      }),
    ).not.toThrow();
  });

  it("accepts explicitly allowed origins", () => {
    expect(() =>
      assertCsrfSafe({
        ...base,
        method: "PATCH",
        origin: "https://admin.example.com",
        secFetchSite: "same-site",
      }),
    ).not.toThrow();
  });

  it("accepts Sec-Fetch-Site same-origin when Origin is absent", () => {
    expect(() =>
      assertCsrfSafe({
        ...base,
        method: "POST",
        origin: null,
        secFetchSite: "same-origin",
      }),
    ).not.toThrow();
  });

  it("rejects cross-site, unknown origins and missing provenance", () => {
    expect(() =>
      assertCsrfSafe({
        ...base,
        method: "POST",
        origin: "https://dashboard.example.com",
        secFetchSite: "cross-site",
      }),
    ).toThrowError(/cross-site/i);

    expect(() =>
      assertCsrfSafe({
        ...base,
        method: "POST",
        origin: "https://evil.example.com",
        secFetchSite: "same-origin",
      }),
    ).toThrowError(/Origen no permitido/i);

    expect(() =>
      assertCsrfSafe({
        ...base,
        method: "DELETE",
        origin: null,
        secFetchSite: null,
      }),
    ).toThrowError(/Faltan cabeceras/i);
  });
});
