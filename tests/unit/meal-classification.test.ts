import { describe, expect, it } from "vitest";
import {
  classifyFoodRecord,
  splitFoodRecords,
} from "@/lib/meal-classification";

describe("classifyFoodRecord", () => {
  it("recognizes real meals", () => {
    expect(classifyFoodRecord("Desayuno")).toBe("meal");
    expect(classifyFoodRecord(" Snack ")).toBe("meal");
    expect(classifyFoodRecord("Cena")).toBe("meal");
  });

  it("recognizes glucose episodes stored in the food table, accents aside", () => {
    expect(classifyFoodRecord("Hipoglucemia")).toBe("glucoseEvent");
    expect(classifyFoodRecord("hiperglucemia")).toBe("glucoseEvent");
    expect(classifyFoodRecord("HYPOGLUCEMIA")).toBe("glucoseEvent");
    expect(classifyFoodRecord("Hypoglycemia")).toBe("glucoseEvent");
  });

  it("reports empty types as untyped meals, not glucose events", () => {
    expect(classifyFoodRecord("")).toBe("untyped");
    expect(classifyFoodRecord("   ")).toBe("untyped");
    expect(classifyFoodRecord(undefined)).toBe("untyped");
  });
});

describe("splitFoodRecords", () => {
  const records = [
    { id: 1, food_type: "Desayuno" },
    { id: 2, food_type: "Hipoglucemia" },
    { id: 3, food_type: "Almuerzo" },
    { id: 4, food_type: "HiperGlucemia" },
    { id: 5, food_type: "" },
  ];

  it("keeps meals and untyped records in the meals group", () => {
    const { meals } = splitFoodRecords(records);
    expect(meals.map((record) => record.id)).toEqual([1, 3, 5]);
  });

  it("isolates glucose events from the meal charts", () => {
    const { glucoseEvents } = splitFoodRecords(records);
    expect(glucoseEvents.map((record) => record.id)).toEqual([2, 4]);
  });

  it("returns empty groups for empty input", () => {
    expect(splitFoodRecords([])).toEqual({ meals: [], glucoseEvents: [] });
  });
});
