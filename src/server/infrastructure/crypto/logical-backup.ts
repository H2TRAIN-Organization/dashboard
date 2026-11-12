import { createCipheriv, createDecipheriv, pbkdf2, randomBytes, scrypt } from "node:crypto";
import { BadRequestError } from "@/server/domain/errors";
import type { BackupKeyMaterial } from "@/server/domain/admin-database";

const FORMAT = "dashboard-encrypted-logical-copy";
const SCRYPT_KDF = { name: "scrypt", N: 131072, r: 8, p: 1, keyLength: 32 } as const;
/** Client-side profile: the browser derives the key and the raw passphrase
 * never reaches the server. Recorded in the envelope so the offline recovery
 * tool can re-derive the same key from the passphrase. */
const PBKDF2_KDF = { name: "pbkdf2", hash: "SHA-256", iterations: 600000, keyLength: 32 } as const;
export const BACKUP_KDF = PBKDF2_KDF;

export interface EncryptedLogicalCopy {
  readonly format: typeof FORMAT;
  readonly version: 1 | 2;
  readonly cipher: "aes-256-gcm";
  readonly kdf: typeof SCRYPT_KDF | typeof PBKDF2_KDF;
  readonly salt: string;
  readonly nonce: string;
  readonly tag: string;
  readonly ciphertext: string;
}

function assertBackupKeyMaterial(material: BackupKeyMaterial): Buffer {
  if (typeof material?.salt !== "string" || typeof material?.key !== "string") {
    throw new BadRequestError("Falta la clave de cifrado derivada por el navegador.");
  }
  const salt = Buffer.from(material.salt, "base64");
  const key = Buffer.from(material.key, "base64");
  if (salt.length !== 32 || key.length !== PBKDF2_KDF.keyLength) {
    throw new BadRequestError("La clave de cifrado derivada no es válida.");
  }
  return key;
}

function header(version: 1 | 2, kdf: typeof SCRYPT_KDF | typeof PBKDF2_KDF, salt: string, nonce: string) {
  return { format: FORMAT, version, cipher: "aes-256-gcm", kdf, salt, nonce } as const;
}

function aesEnvelope(value: unknown, key: Buffer, version: 1 | 2, kdf: typeof SCRYPT_KDF | typeof PBKDF2_KDF, salt: string): EncryptedLogicalCopy {
  const nonce = randomBytes(12);
  const metadata = header(version, kdf, salt, nonce.toString("base64"));
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  try {
    cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { ...metadata, tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  } finally {
    key.fill(0);
  }
}

/** Encrypts with the browser-derived key. The passphrase is never available
 * server-side and is never stored, logged or echoed. */
export async function encryptLogicalCopy(value: unknown, material: BackupKeyMaterial): Promise<EncryptedLogicalCopy> {
  return aesEnvelope(value, assertBackupKeyMaterial(material), 2, PBKDF2_KDF, material.salt);
}

function deriveScrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, SCRYPT_KDF.keyLength, { N: SCRYPT_KDF.N, r: SCRYPT_KDF.r, p: SCRYPT_KDF.p, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

function derivePbkdf2(password: string, salt: Buffer, iterations: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => pbkdf2(password, salt, iterations, keyLength, "sha256", (error, key) => error ? reject(error) : resolve(key)));
}

function assertPassword(password: string) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) throw new BadRequestError("La contraseña debe tener entre 12 y 1024 caracteres.");
}

/** Offline recovery helper for both envelope versions. Wrong passwords and
 * altered files both fail authentication. Version 1 envelopes used a server
 * derived scrypt key; version 2 envelopes record the client PBKDF2 profile. */
export async function decryptLogicalCopy(envelope: EncryptedLogicalCopy, password: string): Promise<unknown> {
  assertPassword(password);
  if (envelope?.format !== FORMAT || envelope?.cipher !== "aes-256-gcm") throw new BadRequestError("Formato de copia no compatible.");
  const salt = Buffer.from(envelope.salt, "base64"), nonce = Buffer.from(envelope.nonce, "base64"), tag = Buffer.from(envelope.tag, "base64");
  if (salt.length !== 32 || nonce.length !== 12 || tag.length !== 16) throw new BadRequestError("Formato de copia no válido.");
  let key: Buffer;
  if (envelope.version === 1 && JSON.stringify(envelope.kdf) === JSON.stringify(SCRYPT_KDF)) {
    key = await deriveScrypt(password, salt);
  } else if (envelope.version === 2 && JSON.stringify(envelope.kdf) === JSON.stringify(PBKDF2_KDF)) {
    key = await derivePbkdf2(password, salt, PBKDF2_KDF.iterations, PBKDF2_KDF.keyLength);
  } else {
    throw new BadRequestError("Formato de copia no compatible.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(JSON.stringify(header(envelope.version, envelope.kdf, envelope.salt, envelope.nonce))));
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(text) as unknown;
  } finally {
    key.fill(0);
  }
}
