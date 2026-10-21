import { z } from "zod";

const dateFilterSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Debe usar el formato YYYY-MM-DD")
  .refine((value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match === null) {
      return false;
    }
    const date = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    return date.toISOString().slice(0, 10) === value;
  }, "Debe ser un día natural válido");

export const decryptedDataQuerySchema = z.strictObject({
  selectedUser: z.string().trim().min(1).max(128).default("all"),
  timeRange: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  selectedDataType: z
    .enum(["all", "insulin", "food", "exercise", "period", "mood"])
    .default("all"),
  dateFilter: dateFilterSchema.optional(),
});

export const legacyDataQuerySchema = z.strictObject({
  type: z.enum(["all", "exercise", "mood", "insulin", "meal"]).default("all"),
  range: z.coerce.number().int().min(1).max(365).default(30),
});
