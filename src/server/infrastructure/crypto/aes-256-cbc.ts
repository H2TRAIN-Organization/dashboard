import { createDecipheriv } from "node:crypto";

import type { EncryptionKeyConfig } from "./config";
import { CryptoError } from "./errors";

const PLAIN_PREFIX = "__PLAIN__";
const HEX_PATTERN = /^[0-9a-f]+$/i;
const IV_HEX_LENGTH = 32;

export interface TextDecryptor {
  decryptText(value: unknown, iv: unknown, field: string): string | null;
  decryptTextArray(value: unknown, iv: unknown, field: string): string[];
}

function parseList(value: unknown, field: string): readonly unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") {
    throw new CryptoError(
      "INVALID_ARRAY",
      `El campo "${field}" no contiene una lista válida.`,
      field,
    );
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [parsed];
  } catch {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}

function isHex(value: string): boolean {
  return value.length % 2 === 0 && HEX_PATTERN.test(value);
}

function looksLikeCiphertext(value: string): boolean {
  return value.length >= 32 && value.length % 32 === 0 && HEX_PATTERN.test(value);
}

function tryDecrypt(key: Buffer, ciphertextHex: string, ivHex: string): string | null {
  try {
    const decipher = createDecipheriv(
      "aes-256-cbc",
      key,
      Buffer.from(ivHex, "hex"),
    );
    let plaintext = decipher.update(ciphertextHex, "hex", "utf8");
    plaintext += decipher.final("utf8");
    return plaintext;
  } catch {
    return null;
  }
}

/**
 * AES-256-CBC compatibility adapter for the legacy dashboard data.
 *
 * Supported input:
 * - ciphertext encoded as hexadecimal;
 * - IV encoded as 32 hexadecimal characters (16 bytes);
 * - `__PLAIN__` prefix for explicitly unencrypted values;
 * - field-specific IV columns (`dose_iv`, `symptoms_iv`, ...);
 * - `text[]` arrays and JSON/comma-separated array strings;
 * - current and previous rotation keys.
 *
 * It never falls back to returning the input ciphertext. Missing or invalid
 * IVs, tampered ciphertext and unknown keys produce explicit errors.
 */
export class Aes256CbcDecryptor implements TextDecryptor {
  private readonly keys: readonly Buffer[];

  constructor(config: EncryptionKeyConfig) {
    const keys = [config.currentKeyHex, config.previousKeyHex]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .filter((value, index, all) => all.indexOf(value) === index)
      .map((value) => {
        if (!/^[0-9a-f]{64}$/i.test(value)) {
          throw new CryptoError(
            "CONFIG_INVALID",
            "Una clave de cifrado no es hexadecimal de 64 caracteres.",
          );
        }
        return Buffer.from(value, "hex");
      });

    if (keys.length === 0) {
      throw new CryptoError(
        "CONFIG_INVALID",
        "Falta la clave de cifrado actual.",
      );
    }
    this.keys = keys;
  }

  decryptText(value: unknown, iv: unknown, field: string): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "string") {
      throw new CryptoError(
        "UNSUPPORTED_VALUE",
        `El campo "${field}" no es texto cifrado válido.`,
        field,
      );
    }
    if (value.length === 0) {
      return "";
    }
    if (value.startsWith(PLAIN_PREFIX)) {
      return value.slice(PLAIN_PREFIX.length);
    }

    if (typeof iv !== "string" || iv.length === 0) {
      throw new CryptoError(
        "MISSING_IV",
        `El campo "${field}" no tiene IV y no está marcado con ${PLAIN_PREFIX}.`,
        field,
      );
    }
    if (iv.length !== IV_HEX_LENGTH || !isHex(iv)) {
      throw new CryptoError(
        "INVALID_IV",
        `El IV del campo "${field}" no es hexadecimal de 32 caracteres.`,
        field,
      );
    }
    if (!isHex(value)) {
      throw new CryptoError(
        "INVALID_CIPHERTEXT",
        `El campo "${field}" no contiene ciphertext hexadecimal válido.`,
        field,
      );
    }

    const normalizedIv = iv.toLowerCase();
    for (const key of this.keys) {
      const first = tryDecrypt(key, value.toLowerCase(), normalizedIv);
      if (first === null) {
        continue;
      }
      if (looksLikeCiphertext(first)) {
        const second = tryDecrypt(key, first.toLowerCase(), normalizedIv);
        if (second === null) {
          throw new CryptoError(
            "AMBIGUOUS_DOUBLE_ENCRYPTION",
            `El campo "${field}" parece doblemente cifrado y no se pudo completar el segundo descifrado.`,
            field,
          );
        }
        return second;
      }
      return first;
    }

    throw new CryptoError(
      "DECRYPTION_FAILED",
      `No se pudo descifrar el campo "${field}" con las claves configuradas.`,
      field,
    );
  }

  decryptTextArray(value: unknown, iv: unknown, field: string): string[] {
    const items = parseList(value, field);
    if (items.length === 0) {
      return [];
    }

    const rawIvs = parseList(iv, field);
    const ivs: string[] = [];
    for (const [index, rawIv] of rawIvs.entries()) {
      if (rawIv === null || rawIv === undefined) {
        ivs.push("");
        continue;
      }
      if (typeof rawIv !== "string") {
        throw new CryptoError(
          "INVALID_IV",
          `El IV del campo "${field}[${index}]" no es texto.`,
          field,
        );
      }
      ivs.push(rawIv);
    }

    return items.map((item, index) => {
      if (item === null || item === undefined) {
        return "";
      }
      if (typeof item !== "string") {
        throw new CryptoError(
          "UNSUPPORTED_VALUE",
          `El elemento ${index} del campo "${field}" no es texto.`,
          field,
        );
      }
      if (item.length === 0 || item === "undefined" || item === "null") {
        return "";
      }
      const itemIv = ivs[index] ?? null;
      return this.decryptText(item, itemIv, `${field}[${index}]`) ?? "";
    });
  }
}
