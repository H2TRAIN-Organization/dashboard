import { z } from "zod";
import { USERNAME_MAX_LENGTH } from "@/server/domain/user";

export const userRoleSchema = z.enum(["admin", "doctor", "user"]);

export const userIdSchema = z.string().trim().min(1).max(128);

const pageSchema = z.coerce.number().int().min(1).max(1_000_000);

const pageSizeSchema = z.coerce
  .number()
  .int()
  .refine((value) => value === 10 || value === 25 || value === 50, {
    message: "pageSize debe ser 10, 25 o 50",
  });

/**
 * Users Management uses 1-based `page` + `pageSize` (10/25/50, default 25).
 * The legacy `limit`/`offset` pair stays for existing clients. Mixing both
 * families is rejected so the effective window is never ambiguous. Filters are
 * always forwarded to the repository; it applies them before the range and
 * returns the filtered count.
 */
export const userListQuerySchema = z
  .strictObject({
    search: z.string().trim().min(1).max(128).optional(),
    role: userRoleSchema.optional(),
    page: pageSchema.optional(),
    pageSize: pageSizeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .superRefine((value, context) => {
    const usesPage = value.page !== undefined || value.pageSize !== undefined;
    const usesLegacy = value.limit !== undefined || value.offset !== undefined;
    if (usesPage && usesLegacy) {
      context.addIssue({
        code: "custom",
        path: ["page"],
        message: "Usa page/pageSize o limit/offset, no ambos",
      });
    }
  })
  .transform((value) => {
    const limit = value.pageSize ?? value.limit ?? 25;
    const offset =
      value.page === undefined ? (value.offset ?? 0) : (value.page - 1) * limit;
    return {
      ...(value.search === undefined ? {} : { search: value.search }),
      ...(value.role === undefined ? {} : { role: value.role }),
      limit,
      offset,
    };
  });

export const createUserBodySchema = z.strictObject({
  username: z.string().trim().min(1).max(USERNAME_MAX_LENGTH),
  email: z.null().optional(),
  password: z.string().min(1).max(1024),
  role: userRoleSchema.default("user"),
  gdprConsent: z.boolean().default(false),
});

export const updateUserBodySchema = z
  .strictObject({
    username: z.string().trim().min(1).max(USERNAME_MAX_LENGTH).optional(),
    email: z.null().optional(),
    role: userRoleSchema.optional(),
    gdprConsent: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviarse al menos un campo",
  });
