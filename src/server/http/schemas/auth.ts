import { z } from "zod";

const passwordSchema = z.string().min(1).max(1024);

export const loginBodySchema = z.union([
  z.strictObject({
    email: z.email().max(320),
    password: passwordSchema,
  }),
  z.strictObject({
    username: z.string().trim().min(1).max(128),
    password: passwordSchema,
  }),
]);
