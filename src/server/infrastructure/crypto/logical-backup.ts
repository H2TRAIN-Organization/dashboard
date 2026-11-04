import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { BadRequestError } from "@/server/domain/errors";

const KDF = { name: "scrypt", N: 131072, r: 8, p: 1, keyLength: 32 } as const;
const FORMAT = "dashboard-encrypted-logical-copy";

export interface EncryptedLogicalCopy {
  readonly format: typeof FORMAT;
  readonly version: 1;
  readonly cipher: "aes-256-gcm";
  readonly kdf: typeof KDF;
  readonly salt: string;
  readonly nonce: string;
  readonly tag: string;
  readonly ciphertext: string;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, KDF.keyLength, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

function assertPassword(password: string) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) throw new BadRequestError("La contraseña debe tener entre 12 y 1024 caracteres.");
}

function header(salt: string, nonce: string) {
  return { format: FORMAT, version: 1, cipher: "aes-256-gcm", kdf: KDF, salt, nonce } as const;
}

export async function encryptLogicalCopy(value: unknown, password: string): Promise<EncryptedLogicalCopy> {
  assertPassword(password);
  const salt = randomBytes(32), nonce = randomBytes(12);
  const key = await derive(password, salt);
  try {
    const metadata = header(salt.toString("base64"), nonce.toString("base64"));
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { ...metadata, tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  } finally {
    key.fill(0);
  }
}

/** Offline recovery helper. Wrong passwords and altered files both fail authentication. */
export async function decryptLogicalCopy(envelope: EncryptedLogicalCopy, password: string): Promise<unknown> {
  assertPassword(password);
  if (envelope.format !== FORMAT || envelope.version !== 1 || envelope.cipher !== "aes-256-gcm" || JSON.stringify(envelope.kdf) !== JSON.stringify(KDF)) throw new BadRequestError("Formato de copia no compatible.");
  const salt = Buffer.from(envelope.salt, "base64"), nonce = Buffer.from(envelope.nonce, "base64"), tag = Buffer.from(envelope.tag, "base64");
  if (salt.length !== 32 || nonce.length !== 12 || tag.length !== 16) throw new BadRequestError("Formato de copia no válido.");
  const key = await derive(password, salt);
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(header(envelope.salt, envelope.nonce))));
    cipher.setAuthTag(tag);
    const text = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, "base64")), cipher.final()]).toString("utf8");
    return JSON.parse(text) as unknown;
  } finally {
    key.fill(0);
  }
}
