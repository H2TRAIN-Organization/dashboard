import { CryptoError } from "./errors";

export interface EncryptionKeyConfig {
  readonly currentKeyHex: string;
  readonly previousKeyHex: string | null;
  /**
   * Oldest historical key. Rows written before the first rotation still need
   * it to decrypt; without it those rows fail closed.
   */
  readonly legacyKeyHex?: string | null;
}

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

/**
 * Retired backend key, kept as the last historical key. It was already
 * published in the legacy server source, so it carries no secret value; rows
 * encrypted before the first rotation still need it.
 */
const RETIRED_SERVER_KEY_HEX =
  "60a50cbe834cda3dc25fb9cede898cb20ffc76c9647e26022ceb2fece1e09b02";

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
  const legacyKeyHex = readKey(
    environment,
    "ENCRYPTION_SECRET_KEY1",
  );

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
  if (legacyKeyHex !== null && !HEX_32_BYTES.test(legacyKeyHex)) {
    throw new CryptoError(
      "CONFIG_INVALID",
      "ENCRYPTION_SECRET_KEY1 debe ser hexadecimal de 64 caracteres (32 bytes).",
    );
  }

  const resolvedLegacy =
    legacyKeyHex ??
    (HEX_32_BYTES.test(RETIRED_SERVER_KEY_HEX) ? RETIRED_SERVER_KEY_HEX : null);

  const dedupe = (
    value: string | null,
    seen: readonly (string | null)[],
  ): string | null => (value === null || seen.includes(value) ? null : value);

  const resolvedPrevious = dedupe(previousKeyHex, [currentKeyHex]);
  const resolvedLegacyKey = dedupe(resolvedLegacy, [
    currentKeyHex,
    resolvedPrevious,
  ]);

  return {
    currentKeyHex,
    previousKeyHex: resolvedPrevious,
    legacyKeyHex: resolvedLegacyKey,
  };
}
