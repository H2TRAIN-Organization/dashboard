/**
 * Live readonly check (explicit opt-in): runs the REAL production composition
 * (repository + resolver + use cases) against the real Supabase project and
 * reports which rows the API would return for the javier account.
 * Never prints ciphertext, keys or hashes.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDataUseCases } from "@/server/application/data/data-use-cases";
import {
  createSupabasePersistenceFromEnvironment,
} from "@/server/infrastructure/persistence/create-supabase-persistence";
import { createBcryptPasswordHasher } from "@/server/infrastructure/persistence";
import bcrypt from "bcryptjs";

const itLive = process.env.DR_LIVE_CHECK === "1" ? it : it.skip;

describe("live alias flow against real Supabase", () => {
  itLive(
    "returns the mobile-app alias mood row for the email account",
    async () => {
      const passwordHasher = createBcryptPasswordHasher(bcrypt);
      const persistence = createSupabasePersistenceFromEnvironment({
        passwordHasher,
      });
      const useCases = createDataUseCases(
        persistence.healthData,
        { now: () => new Date() },
        persistence.healthRecordKeys,
      );

      const actor = {
        userId: "8",
        username: "javier.alayon@ulpgc.es",
        role: "user" as const,
      };

      const resolved = await persistence.healthRecordKeys.resolve({
        username: actor.username,
        userId: actor.userId,
      });
      console.log("RESOLVED KEYS:", JSON.stringify(resolved));

      const data = await useCases.getDecryptedData(actor, {
        selectedUser: actor.username,
        timeRange: "all",
        selectedDataType: "all",
        dateFilter: null,
        dateFrom: null,
        dateTo: null,
      });

      const summary = {
        mood: data.moodData.map((row) => ({
          id: row.id,
          username: row.username,
        })),
        insulin: data.insulinData.map((row) => ({
          id: row.id,
          username: row.username,
        })),
        food: data.foodData.map((row) => ({
          id: row.id,
          username: row.username,
        })),
        exercise: data.exerciseData.map((row) => ({
          id: row.id,
          username: row.username,
        })),
        period: data.periodData.map((row) => ({
          id: row.id,
          username: row.username,
        })),
      };
      console.log("ROWS:", JSON.stringify(summary, null, 1));

      expect(resolved).toContain("auth_d16ebc46-1c2f-4a9e-b5e1-4b2fa997cf99");
      expect(
        summary.mood.some(
          (row) =>
            row.id === 88 &&
            row.username === "auth_d16ebc46-1c2f-4a9e-b5e1-4b2fa997cf99",
        ),
      ).toBe(true);
    },
    30_000,
  );
});
