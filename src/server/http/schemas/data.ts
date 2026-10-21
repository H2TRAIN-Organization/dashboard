import { z } from "zod";

const dateTimeSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  "Debe ser una fecha ISO-8601 válida",
);

export const decryptedDataQuerySchema = z.strictObject({
  selectedUser: z.string().trim().min(1).max(128).default("all"),
  timeRange: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  selectedDataType: z
    .enum(["all", "insulin", "food", "exercise", "period", "mood"])
    .default("all"),
  dateFilter: dateTimeSchema.optional(),
});

export const legacyDataQuerySchema = z.strictObject({
  type: z.enum(["all", "exercise", "mood", "insulin", "meal"]).default("all"),
  range: z.coerce.number().int().min(1).max(365).default(30),
});
