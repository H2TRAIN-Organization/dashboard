import { z } from "zod";
import { USERNAME_MAX_LENGTH } from "@/server/domain/user";

const passwordSchema = z.string().min(1).max(1024);

export const loginBodySchema = z.union([
  z.strictObject({
    // Deliberately not `z.email()`: a legacy public.users.Username may look
    // like an email (including non-ASCII local parts). Requiring `@` keeps the
    // old 400 for identifiers that cannot be the email field, while the auth
    // use case tries Supabase Auth first and then the legacy username.
    email: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .refine((value) => value.includes("@"), {
        message: "El identificador de email debe contener @",
      }),
    password: passwordSchema,
  }),
  z.strictObject({
    username: z.string().trim().min(1).max(USERNAME_MAX_LENGTH),
    password: passwordSchema,
  }),
]);
