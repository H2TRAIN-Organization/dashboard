import { createCipheriv } from "node:crypto";

import type { PasswordHasher } from "@/server/infrastructure/persistence/user/password-hasher";

export const CURRENT_KEY = "11".repeat(32);
export const PREVIOUS_KEY = "22".repeat(32);
export const OTHER_KEY = "33".repeat(32);

export function ivHex(seed: number): string {
  return seed.toString(16).padStart(32, "0");
}

export function encryptText(text: string, keyHex: string, iv: string): string {
  const cipher = createCipheriv(
    "aes-256-cbc",
    Buffer.from(keyHex, "hex"),
    Buffer.from(iv, "hex"),
  );
  return cipher.update(text, "utf8", "hex") + cipher.final("hex");
}

export function encryptTwice(text: string, keyHex: string, iv: string): string {
  return encryptText(encryptText(text, keyHex, iv), keyHex, iv);
}

export function validBcryptHash(fill = "a"): string {
  return `$2b$12$${fill.repeat(53)}`.slice(0, 60);
}

export function fakePasswordHasher(
  hash: string = validBcryptHash(),
  expectedPassword = "correct-password",
): PasswordHasher {
  return {
    async hash(): Promise<string> {
      return hash;
    },
    async verify(password: string, passwordHash: string): Promise<boolean> {
      return password === expectedPassword && passwordHash === hash;
    },
  };
}
