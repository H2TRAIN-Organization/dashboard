import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { AuthMethod } from "./contracts";

const TOKEN_PREFIX = "v1.";
const TOKEN_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MAX_TOKEN_LENGTH = 16_384;
const AAD = Buffer.from("dashboard-auth-session:v1", "utf8");
const HKDF_SALT = Buffer.from("dashboard-auth-session-v1", "utf8");
const HKDF_INFO = Buffer.from("aes-256-gcm-key", "utf8");

export interface SessionTokenPayload {
  readonly v: typeof TOKEN_VERSION;
  /** Random session identifier. Only its SHA-256 hash is persisted. */
  readonly sid: string;
  /** Public user id (public.users.UserID as a string). */
  readonly uid: string;
  readonly method: AuthMethod;
  /** Issued-at, Unix seconds. */
  readonly iat: number;
  /** Expiration, Unix seconds. */
  readonly exp: number;
  /**
   * Present only for email sessions. The whole payload is encrypted with
   * AES-256-GCM, so this credential is not readable in the cookie value.
   */
  readonly supabaseAccessToken?: string;
}

export type SessionTokenInput = Omit<SessionTokenPayload, "v">;

export interface SessionTokenCodec {
  seal(input: SessionTokenInput): string;
  open(token: string, now?: Date): SessionTokenPayload | null;
}

export interface SessionTokenCodecOptions {
  readonly now?: () => Date;
}

/**
 * Generates a 32-byte secret suitable for AUTH_SESSION_SECRET.
 */
export function generateSessionSecret(): string {
  return randomBytes(KEY_BYTES).toString("base64url");
}

/**
 * Accepts a 32+ byte secret encoded as hex, base64/base64url or UTF-8.
 * The value is never printed or included in errors.
 */
export function parseSessionSecret(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("AUTH_SESSION_SECRET está vacío");
  }

  if (/^[0-9a-f]{64,}$/i.test(trimmed)) {
    const fromHex = Buffer.from(trimmed, "hex");
    if (fromHex.length >= KEY_BYTES) {
      return fromHex;
    }
  }

  try {
    const fromBase64 = Buffer.from(trimmed, "base64url");
    if (fromBase64.length >= KEY_BYTES) {
      return fromBase64;
    }
  } catch {
    // Fall through to the UTF-8 passphrase form.
  }

  const utf8 = Buffer.from(trimmed, "utf8");
  if (utf8.length >= KEY_BYTES) {
    return utf8;
  }

  throw new Error(
    "AUTH_SESSION_SECRET debe tener al menos 32 bytes (hex, base64url o texto)",
  );
}

function deriveKey(secret: Buffer): Buffer {
  const derived = hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, KEY_BYTES);
  return Buffer.from(derived);
}

function isAuthMethod(value: unknown): value is AuthMethod {
  return value === "email" || value === "username";
}

function isValidPayload(value: unknown): value is SessionTokenPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === TOKEN_VERSION &&
    typeof candidate.sid === "string" &&
    candidate.sid.length >= 16 &&
    candidate.sid.length <= 256 &&
    typeof candidate.uid === "string" &&
    candidate.uid.length > 0 &&
    candidate.uid.length <= 128 &&
    isAuthMethod(candidate.method) &&
    typeof candidate.iat === "number" &&
    Number.isSafeInteger(candidate.iat) &&
    typeof candidate.exp === "number" &&
    Number.isSafeInteger(candidate.exp) &&
    candidate.exp > candidate.iat &&
    (candidate.supabaseAccessToken === undefined ||
      (typeof candidate.supabaseAccessToken === "string" &&
        candidate.supabaseAccessToken.length > 0 &&
        candidate.supabaseAccessToken.length <= 8_192))
  );
}

/**
 * Encrypts the whole session payload with AES-256-GCM. The cookie value is
 * opaque and tamper-evident; expiry is checked on open.
 */
export function createSessionTokenCodec(
  secret: string | Buffer,
  options: SessionTokenCodecOptions = {},
): SessionTokenCodec {
  const rawSecret = typeof secret === "string" ? parseSessionSecret(secret) : secret;
  if (rawSecret.length < KEY_BYTES) {
    throw new Error("La clave de sesión debe tener al menos 32 bytes");
  }
  const key = deriveKey(rawSecret);
  const now = options.now ?? (() => new Date());

  return {
    seal(input: SessionTokenInput): string {
      const payload: SessionTokenPayload = { v: TOKEN_VERSION, ...input };
      const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const token = Buffer.concat([iv, tag, ciphertext]).toString("base64url");
      return `${TOKEN_PREFIX}${token}`;
    },

    open(token: string, current: Date = now()): SessionTokenPayload | null {
      if (
        typeof token !== "string" ||
        token.length > MAX_TOKEN_LENGTH ||
        !token.startsWith(TOKEN_PREFIX)
      ) {
        return null;
      }

      try {
        const encoded = token.slice(TOKEN_PREFIX.length);
        const packed = Buffer.from(encoded, "base64url");
        if (packed.length <= IV_BYTES + TAG_BYTES) {
          return null;
        }
        const iv = packed.subarray(0, IV_BYTES);
        const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(AAD);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
        if (!isValidPayload(parsed)) {
          return null;
        }
        if (parsed.exp <= Math.floor(current.getTime() / 1000)) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
  };
}
