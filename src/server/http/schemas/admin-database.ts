import { z } from "zod";

export const databaseTableQuerySchema = z.strictObject({  table: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,62}$/, "Nombre de tabla no válido"),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1000).default(0),
});

export const databaseExportQuerySchema = z.strictObject({
  table: databaseTableQuerySchema.shape.table,
  format: z.enum(["json", "csv"]),
});

export const logicalBackupBodySchema = z.strictObject({
  salt: z.base64(),
  /** 32-byte PBKDF2-SHA256 key derived by the browser. The raw passphrase
   * never travels to the server and cannot appear in any payload. */
  key: z.base64(),
});
