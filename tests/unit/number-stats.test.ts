import { describe, expect, it } from "vitest";
import {
  finiteAverage,
  latestValidDate,
  parseFiniteNumber,
  parseFiniteNumberOrZero,
} from "@/lib/number-stats";

describe("parseFiniteNumber", () => {
  it("parses valid decimal text", () => {
    expect(parseFiniteNumber("7.5")).toBe(7.5);
    expect(parseFiniteNumber(" 42 ")).toBe(42);
    expect(parseFiniteNumber("-3")).toBe(-3);
  });

  it("returns null instead of NaN for broken uploader values", () => {
    expect(parseFiniteNumber("")).toBeNull();
    expect(parseFiniteNumber("   ")).toBeNull();
    expect(parseFiniteNumber("N/A")).toBeNull();
    expect(parseFiniteNumber("NaN")).toBeNull();
    expect(parseFiniteNumber(undefined)).toBeNull();
    expect(parseFiniteNumber(null)).toBeNull();
    expect(parseFiniteNumber(Number.NaN)).toBeNull();
    expect(parseFiniteNumber(Infinity)).toBeNull();
  });

  it("treats invalid input as zero when a number is required", () => {
    expect(parseFiniteNumberOrZero("12")).toBe(12);
    expect(parseFiniteNumberOrZero("oops")).toBe(0);
    expect(parseFiniteNumberOrZero(undefined)).toBe(0);
  });
});

describe("finiteAverage", () => {
  it("rounds to one decimal", () => {
    expect(finiteAverage([1.25, 2.5, 3])).toBe(2.3);
  });

  it("ignores non-numeric records instead of poisoning the mean", () => {
    expect(finiteAverage(["60", "oops", undefined, ""])).toBe(60);
  });

  it("returns null when no value is usable", () => {
    expect(finiteAverage([])).toBeNull();
    expect(finiteAverage(["", "N/A"])).toBeNull();
  });
});

describe("latestValidDate", () => {
  it("returns the newest valid date", () => {
    const older = new Date("2026-01-02T00:00:00Z");
    const newer = new Date("2026-06-15T00:00:00Z");
    expect(latestValidDate([older, newer])).toEqual(newer);
  });

  it("skips invalid dates so a broken timestamp cannot yield NaN", () => {
    const valid = new Date("2026-03-10T00:00:00Z");
    const broken = new Date("not-a-date");
    expect(latestValidDate([broken, valid])).toEqual(valid);
    expect(Number.isNaN(broken.getTime())).toBe(true);
  });

  it("returns null when there is no valid date", () => {
    expect(latestValidDate([])).toBeNull();
    expect(latestValidDate([new Date("nope")])).toBeNull();
    expect(latestValidDate(["2026-01-01"])).toBeNull();
  });
});
