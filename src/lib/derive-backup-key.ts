/**
 * Deriva en el navegador la clave de cifrado de la copia lógica.
 *
 * La contraseña del administrador nunca viaja al servidor: se genera un salt
 * local y se envía únicamente la clave derivada (PBKDF2-SHA256, 600 000
 * iteraciones, 32 bytes) junto con el salt. El sobre cifrado registra el
 * perfil KDF, de modo que la herramienta de recuperación offline
 * (scripts/decrypt-logical-copy.mjs) puede re-derivar la misma clave a partir
 * de la contraseña sin contactar con ningún servidor.
 */
export const BACKUP_KDF = { name: "pbkdf2", hash: "SHA-256", iterations: 600000, keyLength: 32 } as const;

export interface DerivedBackupKey {
  readonly kdf: typeof BACKUP_KDF;
  /** Salt aleatorio de 32 bytes en base64, generado en el navegador. */
  readonly salt: string;
  /** Clave derivada de 32 bytes en base64. La contraseña no se incluye. */
  readonly key: string;
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function deriveBackupKey(password: string): Promise<DerivedBackupKey> {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new Error("La contraseña debe tener entre 12 y 1024 caracteres.");
  }
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("El navegador no soporta WebCrypto; la descarga cifrada no está disponible.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const key = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: BACKUP_KDF.iterations }, keyMaterial, BACKUP_KDF.keyLength * 8);
  return { kdf: BACKUP_KDF, salt: toBase64(salt), key: toBase64(key) };
}
