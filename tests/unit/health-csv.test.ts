import { describe, expect, it } from "vitest";
import {
  HEALTH_CSV_COLUMNS,
  HEALTH_DATA_CATEGORIES,
  buildHealthCsvDocument,
  buildHealthCsvRows,
  escapeHealthCsvValue,
  healthCsvFilename,
  serializeHealthCsv,
  type HealthCsvRow,
  type HealthDataCollections,
} from "@/lib/health-csv";

function sampleCollections(): HealthDataCollections {
  return {
    insulinData: [
      {
        id: "ins-1",
        username: "ana.ñúñez@example.com",
        insulinType: 'Rápida; "bolo"',
        dose: "0",
        date_time: "2026-01-02T03:04:05.000Z",
        actualDateTime: "2026-01-02T02:04:05.000Z",
        insulintype_iv: "cipher-insulin-type",
        dose_iv: "cipher-dose",
      },
    ],
    foodData: [
      {
        id: "food-1",
        username: "ana.ñúñez@example.com",
        food_type: "Arroz con leche",
        quantity: "0",
        carbs: "45",
        date_time: "2026-01-03T10:00:00.000Z",
        food_type_iv: "cipher-food",
      },
    ],
    exerciseData: [
      {
        id: "ex-1",
        username: "ana.ñúñez@example.com",
        exercise_type: "Carrera",
        intensity: "",
        exercise_start_time: "2026-01-04T08:00:00.000Z",
        exercise_end_time: "2026-01-04T08:30:00.000Z",
        exercise_description: "Carrera\nsuave",
        date_time: "2026-01-04T08:30:00.000Z",
        exercise_description_iv: "cipher-description",
      },
    ],
    periodData: [
      {
        id: "period-1",
        username: "ana.ñúñez@example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-05",
        intensity: "Leve",
        symptoms: ["dolor", "cólicos"],
        notes: "ñandú",
        date_time: "2026-01-01T00:00:00.000Z",
        symptoms_iv: ["cipher-symptom"],
      },
    ],
    moodData: [
      {
        id: "mood-1",
        username: "ana.ñúñez@example.com",
        mood_value: 0,
        out_of_routine: false,
        routine_description: "Sin rutina",
        emotions: [],
        other_emotion: "",
        date_time: "2026-01-05T21:15:00.000Z",
        emotions_iv: ["cipher-emotion"],
      },
    ],
  };
}

function rowFor(rows: readonly HealthCsvRow[], category: string): HealthCsvRow {
  const row = rows.find((entry) => entry.category === category);
  if (row === undefined) {
    throw new Error(`Missing CSV row for category ${category}`);
  }
  return row;
}

describe("health CSV contract", () => {
  it("uses one header with the union of the five categories and a stable order", () => {
    const rows = buildHealthCsvRows(sampleCollections());

    expect(HEALTH_CSV_COLUMNS[0]).toBe("record_id");
    expect(HEALTH_CSV_COLUMNS).toContain("insulin_dose");
    expect(HEALTH_CSV_COLUMNS).toContain("food_carbs");
    expect(HEALTH_CSV_COLUMNS).toContain("exercise_intensity");
    expect(HEALTH_CSV_COLUMNS).toContain("period_intensity");
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(Object.keys(row)).toEqual([...HEALTH_CSV_COLUMNS]);
    }
    expect(rows.map((row) => row.category)).toEqual([...HEALTH_DATA_CATEGORIES]);
  });

  it("keeps zeros, false, accents and date with time", () => {
    const rows = buildHealthCsvRows(sampleCollections());
    const insulin = rowFor(rows, "insulin");
    const food = rowFor(rows, "food");
    const period = rowFor(rows, "period");
    const mood = rowFor(rows, "mood");

    expect(insulin.insulin_dose).toBe("0");
    expect(insulin.recorded_at).toBe("2026-01-02T03:04:05.000Z");
    expect(insulin.insulin_actual_date_time).toBe("2026-01-02T02:04:05.000Z");
    expect(food.food_quantity).toBe("0");
    expect(food.food_carbs).toBe("45");
    expect(period.period_start_date).toBe("2026-01-01");
    expect(period.period_notes).toBe("ñandú");
    expect(mood.mood_value).toBe("0");
    expect(mood.mood_out_of_routine).toBe("false");
    expect(mood.recorded_at).toBe("2026-01-05T21:15:00.000Z");
  });

  it("leaves non-applicable cells empty without shifting the row", () => {
    const rows = buildHealthCsvRows(sampleCollections());
    const insulin = rowFor(rows, "insulin");
    const food = rowFor(rows, "food");

    expect(insulin.food_type).toBe("");
    expect(insulin.food_carbs).toBe("");
    expect(insulin.period_notes).toBe("");
    expect(insulin.mood_value).toBe("");
    expect(food.insulin_dose).toBe("");
    expect(food.insulin_actual_date_time).toBe("");
    expect(food.exercise_start_time).toBe("");
  });

  it("never exports ciphertext companions or internal fields", () => {
    const csv = serializeHealthCsv(buildHealthCsvRows(sampleCollections()));

    expect(HEALTH_CSV_COLUMNS.some((column) => column.endsWith("_iv"))).toBe(false);
    for (const secret of [
      "cipher-insulin-type",
      "cipher-dose",
      "cipher-food",
      "cipher-description",
      "cipher-symptom",
      "cipher-emotion",
      "PasswordHash",
    ]) {
      expect(csv).not.toContain(secret);
    }
    expect(csv).not.toContain("actualDateTime");
  });

  it("escapes separators, quotes and newlines while preserving the value", () => {
    const csv = serializeHealthCsv(buildHealthCsvRows(sampleCollections()));

    expect(csv).toContain('"Rápida; ""bolo"""');
    expect(csv).toContain('"Carrera\nsuave"');
    expect(escapeHealthCsvValue("  padded  ")).toBe('"  padded  "');
    expect(escapeHealthCsvValue("plain")).toBe("plain");
    expect(escapeHealthCsvValue("")).toBe("");
  });

  it("applies the same schema to a single-category export", () => {
    const rows = buildHealthCsvRows(sampleCollections(), {
      categories: ["mood"],
    });
    const csv = serializeHealthCsv(rows);
    const header = csv.split("\n")[0] ?? "";

    expect(rows).toHaveLength(1);
    expect(rows[0]?.category).toBe("mood");
    expect(header).toBe(HEALTH_CSV_COLUMNS.join(";"));
    expect(header.split(";")).toHaveLength(HEALTH_CSV_COLUMNS.length);
  });

  it("keeps participant text from becoming a spreadsheet formula while preserving numeric values", () => {
    expect(escapeHealthCsvValue('=1+2')).toBe("'=1+2");
    expect(escapeHealthCsvValue(' \t@SUM(1)')).toBe("' \t@SUM(1)");
    expect(escapeHealthCsvValue('-malicious-command')).toBe("'-malicious-command");
    expect(escapeHealthCsvValue('-2026110301')).toBe('-2026110301');
    expect(escapeHealthCsvValue('0')).toBe('0');
    expect(escapeHealthCsvValue('false')).toBe('false');
  });

  it("returns a UTF-8 BOM document and a predictable filename", () => {
    const document = buildHealthCsvDocument(sampleCollections());
    expect(document.startsWith("\uFEFF")).toBe(true);
    expect(healthCsvFilename(undefined)).toBe("datos_salud.csv");
    expect(healthCsvFilename(["insulin"])).toBe("datos_salud_insulin.csv");
    expect(healthCsvFilename([...HEALTH_DATA_CATEGORIES])).toBe("datos_salud.csv");
  });
});
