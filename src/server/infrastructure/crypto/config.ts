import { CryptoError } from "./errors";

export interface EncryptionKeyConfig {
  readonly currentKeyHex: string;
  readonly previousKeyHex: string | null;
}

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

type Environment = Readonly<Record<string, string | undefined>>;

function readKey(
  environment: Environment,
  name: string,
): string | null {
  const value = environment[name];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}

/**
 * Reads the AES-256-CBC keys used by the legacy backend. Both are 64-character
 * hexadecimal strings (32 bytes). Values are never included in errors or logs.
 */
export function readEncryptionKeyConfig(
  environment: Environment = process.env,
): EncryptionKeyConfig {
  const currentKeyHex = readKey(environment, "ENCRYPTION_SECRET_KEY");
  const previousKeyHex = readKey(environment, "ENCRYPTION_SECRET_KEY0");

  if (currentKeyHex === null) {
    throw new CryptoError(
      "CONFIG_INVALID",
      "Falta ENCRYPTION_SECRET_KEY; no se puede descifrar.",
    );
  }
  if (!HEX_32_BYTES.test(currentKeyHex)) {
    throw new CryptoError(
      "CONFIG_INVALID",
      "ENCRYPTION_SECRET_KEY debe ser hexadecimal de 64 caracteres (32 bytes).",
    );
  }
  if (previousKeyHex !== null && !HEX_32_BYTES.test(previousKeyHex)) {
    throw new CryptoError(
      "CONFIG_INVALID",
      "ENCRYPTION_SECRET_KEY0 debe ser hexadecimal de 64 caracteres (32 bytes).",
    );
  }

  return {
    currentKeyHex,
    previousKeyHex:
      previousKeyHex === null || previousKeyHex === currentKeyHex
        ? null
        : previousKeyHex,
  };
}
