export type CryptoErrorCode =
  | "CONFIG_INVALID"
  | "MISSING_IV"
  | "INVALID_IV"
  | "INVALID_CIPHERTEXT"
  | "UNSUPPORTED_VALUE"
  | "DECRYPTION_FAILED"
  | "AMBIGUOUS_DOUBLE_ENCRYPTION"
  | "INVALID_ARRAY";

/**
 * Decryption error with a safe message. It never contains ciphertext, IVs,
 * keys or decrypted values.
 */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode;
  readonly field: string | null;

  constructor(code: CryptoErrorCode, message: string, field?: string) {
    super(message);
    this.name = "CryptoError";
    this.code = code;
    this.field = field ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
