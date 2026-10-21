import type { HealthRecord } from "@/server/domain/health-data";
import type { TextDecryptor } from "@/server/infrastructure/crypto";

import { asRecord } from "../ids";

export const HEALTH_TABLES = [
  "insulindata",
  "fooddata",
  "exercisedata",
  "periodrecords",
  "mooddata",
  "polar_data",
] as const;

export type HealthTable = (typeof HEALTH_TABLES)[number];

export const DECRYPTED_HEALTH_TABLES = [
  "insulindata",
  "fooddata",
  "exercisedata",
  "periodrecords",
  "mooddata",
] as const;

export type DecryptedHealthTable = (typeof DECRYPTED_HEALTH_TABLES)[number];

interface ScalarField {
  readonly source: string;
  readonly iv: string;
}

interface ArrayField {
  readonly source: string;
  readonly iv: string;
}

interface TableSpec {
  readonly scalar: readonly ScalarField[];
  readonly arrays: readonly ArrayField[];
}

const TABLE_SPECS: Record<HealthTable, TableSpec> = {
  insulindata: {
    scalar: [
      { source: "insulinType", iv: "insulintype_iv" },
      { source: "dose", iv: "dose_iv" },
    ],
    arrays: [],
  },
  fooddata: {
    scalar: [
      { source: "food_type", iv: "food_type_iv" },
      { source: "quantity", iv: "quantity_iv" },
      { source: "carbs", iv: "carbs_iv" },
    ],
    arrays: [],
  },
  exercisedata: {
    scalar: [
      { source: "exercise_type", iv: "exercise_type_iv" },
      { source: "exercise_description", iv: "exercise_description_iv" },
    ],
    arrays: [],
  },
  periodrecords: {
    scalar: [
      { source: "intensity", iv: "intensity_iv" },
      { source: "notes", iv: "notes_iv" },
    ],
    arrays: [{ source: "symptoms", iv: "symptoms_iv" }],
  },
  mooddata: {
    scalar: [
      { source: "routine_description", iv: "routine_description_iv" },
      { source: "other_emotion", iv: "other_emotion_iv" },
    ],
    arrays: [{ source: "emotions", iv: "emotions_iv" }],
  },
  polar_data: {
    scalar: [],
    arrays: [],
  },
};

const SENSITIVE_KEY = /pass(?:word)?hash|password|secret|token|cipher|(^|_)iv$/i;

export function isHealthTable(value: string): value is HealthTable {
  return (HEALTH_TABLES as readonly string[]).includes(value);
}

export function isDecryptedHealthTable(value: string): value is DecryptedHealthTable {
  return (DECRYPTED_HEALTH_TABLES as readonly string[]).includes(value);
}

/**
 * Returns a decrypted record with every IV/ciphertext/credential-like key
 * removed. Encrypted fields are replaced in place so the legacy UI keeps its
 * column names and array shapes.
 */
export function mapHealthRecord(
  table: HealthTable,
  value: unknown,
  decryptor: TextDecryptor,
): HealthRecord {
  const row = asRecord(value, table);
  const output: Record<string, unknown> = { ...row };
  const spec = TABLE_SPECS[table];
  const handledSources = new Set(
    [...spec.scalar, ...spec.arrays].map((field) => field.source.toLowerCase()),
  );

  for (const key of Object.keys(output)) {
    if (SENSITIVE_KEY.test(key)) {
      delete output[key];
    }
  }

  // If the remote schema gains an `_iv` column that this adapter does not know,
  // remove its source field too instead of leaking ciphertext into the response.
  for (const key of Object.keys(row)) {
    if (!key.endsWith("_iv") || key.length <= 3) {
      continue;
    }
    const source = key.slice(0, -3);
    if (handledSources.has(source.toLowerCase())) {
      continue;
    }
    for (const candidate of Object.keys(output)) {
      if (candidate.toLowerCase() === source.toLowerCase()) {
        delete output[candidate];
      }
    }
  }
  for (const field of spec.scalar) {
    if (!(field.source in row)) {
      continue;
    }
    output[field.source] = decryptor.decryptText(
      row[field.source],
      row[field.iv],
      `${table}.${field.source}`,
    );
  }
  for (const field of spec.arrays) {
    output[field.source] = decryptor.decryptTextArray(
      row[field.source],
      row[field.iv],
      `${table}.${field.source}`,
    );
  }

  return output;
}
