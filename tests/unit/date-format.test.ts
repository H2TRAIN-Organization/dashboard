import { describe, expect, it } from "vitest";

import {
  formatEuropeanDate,
  formatEuropeanDateTime,
  formatEuropeanFullDate,
  formatEuropeanShortDay,
} from "@/lib/date-format";

/** Fixed local-time fixture so expectations are timezone-independent. */
function local(yyyy: number, mm: number, dd: number, hh = 0, mi = 0): Date {
  return new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
}

describe("European date formatting", () => {
  it("renders day-first dd/mm/aaaa", () => {
    expect(formatEuropeanDate(local(2026, 11, 16))).toBe("16/11/2026");
    expect(formatEuropeanDate(local(2026, 1, 3))).toBe("03/01/2026");
  });

  it("renders day-first with the time part when given", () => {
    expect(formatEuropeanDateTime(local(2026, 11, 16, 12, 5))).toBe(
      "16/11/2026, 12:05",
    );
  });

  it("renders short labels day-first with the language month", () => {
    expect(formatEuropeanShortDay(local(2026, 11, 16), "es-ES")).toMatch(
      /^16 nov/i,
    );
    expect(formatEuropeanShortDay(local(2026, 11, 16), "en-US")).toMatch(
      /^16 Nov/i,
    );
  });

  it("renders full dates day-first in both languages", () => {
    expect(formatEuropeanFullDate(local(2026, 11, 16), "es-ES")).toMatch(
      /16 de noviembre de 2026$/,
    );
    expect(formatEuropeanFullDate(local(2026, 11, 16), "en-US")).toMatch(
      /16 November 2026$/,
    );
  });

  it("returns an empty string for invalid values instead of throwing", () => {
    expect(formatEuropeanDate("no-es-fecha")).toBe("");
    expect(formatEuropeanDateTime("")).toBe("");
    expect(formatEuropeanShortDay("x", "es-ES")).toBe("");
    expect(formatEuropeanFullDate("x", "es-ES")).toBe("");
  });
});
