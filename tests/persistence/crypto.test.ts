import { describe, expect, it } from "vitest";

import { Aes256CbcDecryptor } from "@/server/infrastructure/crypto/aes-256-cbc";
import { readEncryptionKeyConfig } from "@/server/infrastructure/crypto/config";
import { CryptoError } from "@/server/infrastructure/crypto/errors";

import {
  CURRENT_KEY,
  encryptText,
  encryptTwice,
  ivHex,
  OTHER_KEY,
  PREVIOUS_KEY,
} from "./helpers/crypto-fixtures";

function decryptor(previous: string | null = PREVIOUS_KEY): Aes256CbcDecryptor {
  return new Aes256CbcDecryptor({
    currentKeyHex: CURRENT_KEY,
    previousKeyHex: previous,
  });
}

describe("AES-256-CBC legacy decryption", () => {
  it("decrypts with the current key", () => {
    const ciphertext = encryptText("bolus", CURRENT_KEY, ivHex(1));
    expect(decryptor().decryptText(ciphertext, ivHex(1), "insulindata.insulinType")).toBe(
      "bolus",
    );
  });

  it("decrypts with the previous rotation key", () => {
    const ciphertext = encryptText("4 units", PREVIOUS_KEY, ivHex(2));
    expect(decryptor().decryptText(ciphertext, ivHex(2), "insulindata.dose")).toBe(
      "4 units",
    );
  });

  it("handles legacy double encryption with the same key", () => {
    const ciphertext = encryptTwice("lunch", CURRENT_KEY, ivHex(3));
    expect(decryptor().decryptText(ciphertext, ivHex(3), "fooddata.food_type")).toBe(
      "lunch",
    );
  });

  it("strips __PLAIN__ even without an IV", () => {
    expect(
      decryptor().decryptText("__PLAIN__plain text", null, "mooddata.notes"),
    ).toBe("plain text");
  });

  it("rejects a missing IV instead of returning ciphertext as text", () => {
    const ciphertext = encryptText("secret", CURRENT_KEY, ivHex(4));
    try {
      decryptor().decryptText(ciphertext, null, "insulindata.dose");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      const cryptoError = error as CryptoError;
      expect(cryptoError.code).toBe("MISSING_IV");
      expect(cryptoError.message).not.toContain(ciphertext);
      expect(cryptoError.message).not.toContain(CURRENT_KEY);
    }
  });

  it("rejects ciphertext when no configured key matches", () => {
    const ciphertext = encryptText("secret", OTHER_KEY, ivHex(5));
    try {
      decryptor().decryptText(ciphertext, ivHex(5), "insulindata.dose");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      const cryptoError = error as CryptoError;
      expect(cryptoError.code).toBe("DECRYPTION_FAILED");
      expect(cryptoError.message).not.toContain(ciphertext);
      expect(cryptoError.message).not.toContain(OTHER_KEY);
    }
  });

  it("rejects invalid IV and ciphertext encodings explicitly", () => {
    const ciphertext = encryptText("secret", CURRENT_KEY, ivHex(6));
    expect(() => decryptor().decryptText(ciphertext, "zz".repeat(16), "x")).toThrowError(
      expect.objectContaining({ code: "INVALID_IV" }),
    );
    expect(() => decryptor().decryptText("not-hex", ivHex(6), "x")).toThrowError(
      expect.objectContaining({ code: "INVALID_CIPHERTEXT" }),
    );
  });

  it("rejects tampered ciphertext", () => {
    const ciphertext = encryptText("secret", CURRENT_KEY, ivHex(7));
    const tampered = `${ciphertext.slice(0, -2)}00`;
    expect(() => decryptor().decryptText(tampered, ivHex(7), "x")).toThrowError(
      expect.objectContaining({ code: "DECRYPTION_FAILED" }),
    );
  });

  it("decrypts text[] arrays and JSON/comma array strings", () => {
    const first = encryptText("nausea", CURRENT_KEY, ivHex(8));
    const second = encryptText("fatigue", CURRENT_KEY, ivHex(9));
    const ivs = [ivHex(8), ivHex(9)];

    expect(decryptor().decryptTextArray([first, second], ivs, "periodrecords.symptoms"))
      .toEqual(["nausea", "fatigue"]);
    expect(
      decryptor().decryptTextArray(
        JSON.stringify([first, second]),
        JSON.stringify(ivs),
        "periodrecords.symptoms",
      ),
    ).toEqual(["nausea", "fatigue"]);
    expect(
      decryptor().decryptTextArray(
        `${first},${second}`,
        `${ivHex(8)},${ivHex(9)}`,
        "periodrecords.symptoms",
      ),
    ).toEqual(["nausea", "fatigue"]);
  });

  it("handles null, empty and partial array values without echo", () => {
    const d = decryptor();
    expect(d.decryptTextArray(null, null, "mooddata.emotions")).toEqual([]);
    expect(d.decryptTextArray("", "", "mooddata.emotions")).toEqual([]);
    expect(d.decryptTextArray(["", null, "undefined"], [], "mooddata.emotions")).toEqual([
      "",
      "",
      "",
    ]);
    expect(d.decryptText(null, null, "mooddata.other_emotion")).toBeNull();
    expect(d.decryptText("", null, "mooddata.other_emotion")).toBe("");
  });

  it("fails when an array element has no matching IV", () => {
    const first = encryptText("nausea", CURRENT_KEY, ivHex(10));
    const second = encryptText("fatigue", CURRENT_KEY, ivHex(11));
    expect(() =>
      dClosure().decryptTextArray([first, second], [ivHex(10)], "periodrecords.symptoms"),
    ).toThrowError(expect.objectContaining({ code: "MISSING_IV" }));
  });

  it("rejects non-string scalar values", () => {
    expect(() => decryptor().decryptText(42, ivHex(12), "x")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_VALUE" }),
    );
  });
});

function dClosure(): Aes256CbcDecryptor {
  return decryptor();
}

describe("encryption key config", () => {
  it("reads current and previous 64-hex keys", () => {
    const config = readEncryptionKeyConfig({
      ENCRYPTION_SECRET_KEY: CURRENT_KEY,
      ENCRYPTION_SECRET_KEY0: PREVIOUS_KEY,
    });
    expect(config).toEqual({
      currentKeyHex: CURRENT_KEY,
      previousKeyHex: PREVIOUS_KEY,
    });
  });

  it("rejects missing or non-64-hex keys without echoing them", () => {
    expect(() => readEncryptionKeyConfig({})).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
    const bad = "abc123";
    try {
      readEncryptionKeyConfig({ ENCRYPTION_SECRET_KEY: bad });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      expect((error as CryptoError).message).not.toContain(bad);
    }
  });

  it("rejects an invalid previous key", () => {
    expect(() =>
      readEncryptionKeyConfig({
        ENCRYPTION_SECRET_KEY: CURRENT_KEY,
        ENCRYPTION_SECRET_KEY0: "not-a-key",
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });
});
