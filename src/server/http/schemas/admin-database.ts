import { z } from "zod";

export const databaseTableQuerySchema = z.strictObject({
  table: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,62}$/, "Nombre de tabla no válido"),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});
