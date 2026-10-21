import { z } from "zod";
import { USERNAME_MAX_LENGTH } from "@/server/domain/user";

export const userRoleSchema = z.enum(["admin", "doctor", "user"]);

export const userIdSchema = z.string().trim().min(1).max(128);

export const userListQuerySchema = z
  .strictObject({
    search: z.string().trim().min(1).max(128).optional(),
    role: userRoleSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .transform((value) => ({
    ...value,
    search: value.search === undefined ? undefined : value.search.trim(),
  }));

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
