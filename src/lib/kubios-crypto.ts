import 'server-only'

/**
 * Cifrado y descifrado de datos de Kubios para uso exclusivo en servidor.
 *
 * Algoritmo: AES-256-GCM con una clave privada leída de
 * `KUBIOS_ENCRYPTION_KEY_V1`, codificada en base64 y que debe decodificar
 * exactamente a 32 bytes. Cada operación usa un nonce aleatorio de 12 bytes y
 * produce una etiqueta de autenticación de 16 bytes. La clave nunca se
 * registra ni se expone; esta variable no debe llevar el prefijo público de
 * Next.js.
 *
 * Formato del sobre (un único string base64 que codifica esta secuencia):
 *
 *   offset  tamaño  campo
 *   0       1       versión de clave (siempre 0x01)
 *   1       12      nonce aleatorio
 *   13      16      etiqueta de autenticación GCM
 *   29      n >= 1  ciphertext
 *
 * El sobre completo mide al menos 30 bytes. `0x01` es la única versión
 * aceptada al descifrar; cualquier otra se rechaza. No se usa ningún estándar
 * externo de envelope: el formato anterior es propio y determinista.
 *
 * Contexto AAD obligatorio: se construye de forma canónica a partir de
 * `teamId`, `memberId` y `purpose`, precediendo cada campo por su longitud en
 * bytes UTF-8:
 *
 *   kubios-crypto-aad:v1|teamId:<bytes>:<teamId>|memberId:<bytes>:<memberId>|purpose:<bytes>:<purpose>
 *
 * Los prefijos de longitud evitan colisiones aunque los valores contengan los
 * separadores. Alterar `teamId`, `memberId` o `purpose` hace fallar la
 * autenticación GCM. `snapshot` y `token` usan contextos distintos aunque
 * compartan el mismo equipo y miembro.
 *
 * Restricción de servidor: el módulo importa `server-only`, por lo que Next.js
 * rechaza la compilación si se importa desde un componente cliente. Además, en
 * tiempo de ejecución se comprueba que no exista `window`/`document`, se exige
 * el runtime Node.js y `process.env`, y se depende de `node:crypto`, que no
 * puede empaquetarse para el navegador.
 */

import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** Variable de entorno que contiene la clave privada (base64 de 32 bytes). */
export const KUBIOS_ENCRYPTION_KEY_ENV = 'KUBIOS_ENCRYPTION_KEY_V1'

/** Versión del formato de clave y de sobre aceptada por este módulo. */
export const KUBIOS_KEY_VERSION = 1

/** Longitud del nonce en bytes. */
export const KUBIOS_NONCE_BYTES = 12

/** Longitud de la etiqueta de autenticación GCM en bytes. */
export const KUBIOS_AUTH_TAG_BYTES = 16

const KUBIOS_KEY_BYTES = 32
const KUBIOS_CIPHER = 'aes-256-gcm'

const VERSION_OFFSET = 0
const NONCE_OFFSET = VERSION_OFFSET + 1
const AUTH_TAG_OFFSET = NONCE_OFFSET + KUBIOS_NONCE_BYTES
const CIPHERTEXT_OFFSET = AUTH_TAG_OFFSET + KUBIOS_AUTH_TAG_BYTES
const MIN_ENVELOPE_BYTES = CIPHERTEXT_OFFSET + 1

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Propósitos admitidos; forman parte del contexto autenticado (AAD). */
export type KubiosCryptoPurpose = 'snapshot' | 'token'

/** Contexto obligatorio que se autentica junto con el texto cifrado. */
export interface KubiosEncryptionContext {
  readonly teamId: string
  readonly memberId: string
  readonly purpose: KubiosCryptoPurpose
}

/** Equipo y miembro para las funciones específicas de snapshot o token. */
export interface KubiosTeamMemberScope {
  readonly teamId: string
  readonly memberId: string
}

/** Fuente de variables de entorno; por defecto `process.env`. */
export type KubiosCryptoEnv = Record<string, string | undefined>

/** Opciones de las funciones de cifrado y descifrado. */
export interface KubiosCryptoOptions {
  /**
   * Fuente de variables de entorno. Solo debe usarse desde servidor o tests;
   * por defecto se lee `process.env`.
   */
  readonly env?: KubiosCryptoEnv
}

/** Códigos de error seguros: no describen la clave, el texto ni el cifrado. */
export type KubiosCryptoErrorCode =
  | 'server_only'
  | 'missing_key'
  | 'invalid_key'
  | 'invalid_context'
  | 'invalid_plaintext'
  | 'invalid_payload'
  | 'unsupported_version'
  | 'encryption_failed'
  | 'decryption_failed'

/**
 * Error controlado del módulo. El mensaje es genérico y nunca incluye la
 * clave, el texto claro ni fragmentos del ciphertext.
 */
export class KubiosCryptoError extends Error {
  readonly code: KubiosCryptoErrorCode

  constructor(code: KubiosCryptoErrorCode, message: string) {
    super(message)
    this.name = 'KubiosCryptoError'
    this.code = code
  }
}

interface ParsedKubiosEnvelope {
  readonly nonce: Buffer
  readonly authTag: Buffer
  readonly ciphertext: Buffer
}

function assertServerContext(): void {
  if (typeof window !== 'undefined' || typeof document !== 'undefined') {
    throw new KubiosCryptoError(
      'server_only',
      'El cifrado de Kubios solo puede ejecutarse en el servidor'
    )
  }

  if (typeof process === 'undefined' || process.versions?.node === undefined) {
    throw new KubiosCryptoError(
      'server_only',
      'El cifrado de Kubios requiere el runtime Node.js del servidor'
    )
  }
}

function resolveEnv(options: KubiosCryptoOptions | null | undefined): KubiosCryptoEnv {
  const env = options?.env
  if (env !== undefined) return env

  if (typeof process === 'undefined' || process.env === undefined) {
    throw new KubiosCryptoError(
      'server_only',
      'El cifrado de Kubios requiere un entorno de servidor Node.js'
    )
  }

  return process.env
}

function invalidContextError(): KubiosCryptoError {
  return new KubiosCryptoError(
    'invalid_context',
    'El contexto de cifrado de Kubios requiere teamId, memberId y purpose válidos'
  )
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isKubiosCryptoPurpose(value: unknown): value is KubiosCryptoPurpose {
  return value === 'snapshot' || value === 'token'
}

/**
 * Valida el contexto y devuelve una copia para que no pueda cambiar entre la
 * validación y el cifrado.
 */
function validateContext(context: KubiosEncryptionContext): KubiosEncryptionContext {
  if (context == null || typeof context !== 'object') {
    throw invalidContextError()
  }

  const { teamId, memberId, purpose } = context
  if (!isNonBlankString(teamId) || !isNonBlankString(memberId) || !isKubiosCryptoPurpose(purpose)) {
    throw invalidContextError()
  }

  return { teamId, memberId, purpose }
}

function toScopeContext(
  scope: KubiosTeamMemberScope | null | undefined,
  purpose: KubiosCryptoPurpose
): KubiosEncryptionContext {
  if (scope == null) {
    throw invalidContextError()
  }

  return { teamId: scope.teamId, memberId: scope.memberId, purpose }
}

function lengthPrefixed(value: string): string {
  return `${Buffer.byteLength(value, 'utf8')}:${value}`
}

/**
 * Construye el AAD canónico. La longitud de cada campo elimina la ambigüedad
 * de usar separadores dentro de los valores.
 */
function buildAdditionalData(context: KubiosEncryptionContext): Buffer {
  return Buffer.from(
    `kubios-crypto-aad:v1|teamId:${lengthPrefixed(context.teamId)}|memberId:${lengthPrefixed(
      context.memberId
    )}|purpose:${lengthPrefixed(context.purpose)}`,
    'utf8'
  )
}

/**
 * Decodifica base64 estándar de forma estricta y canónica. Devuelve `null` si
 * el valor no es base64 válido o no usa la representación canónica.
 */
function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    return null
  }

  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    decoded.fill(0)
    return null
  }

  return decoded
}

/** Carga y valida la clave. Los errores solo nombran la variable, nunca su valor. */
function loadEncryptionKey(env: KubiosCryptoEnv): Buffer {
  const raw = env[KUBIOS_ENCRYPTION_KEY_ENV]
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new KubiosCryptoError(
      'missing_key',
      `Falta la variable de entorno ${KUBIOS_ENCRYPTION_KEY_ENV} o está vacía`
    )
  }

  const key = decodeCanonicalBase64(raw.trim())
  if (key === null || key.length !== KUBIOS_KEY_BYTES) {
    if (key !== null) key.fill(0)
    throw new KubiosCryptoError(
      'invalid_key',
      `La variable ${KUBIOS_ENCRYPTION_KEY_ENV} debe contener base64 de exactamente 32 bytes`
    )
  }

  return key
}

/** Valida y separa el sobre; la versión se comprueba antes de cargar la clave. */
function parseEnvelope(payload: unknown): ParsedKubiosEnvelope {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new KubiosCryptoError('invalid_payload', 'El payload cifrado de Kubios no es válido')
  }

  const envelope = decodeCanonicalBase64(payload)
  if (envelope === null) {
    throw new KubiosCryptoError('invalid_payload', 'El payload cifrado de Kubios no es base64 válido')
  }

  const keyVersion = envelope.readUInt8(VERSION_OFFSET)
  if (keyVersion !== KUBIOS_KEY_VERSION) {
    throw new KubiosCryptoError(
      'unsupported_version',
      'La versión del cifrado de Kubios no está soportada'
    )
  }

  if (envelope.length < MIN_ENVELOPE_BYTES) {
    throw new KubiosCryptoError(
      'invalid_payload',
      'El payload cifrado de Kubios está truncado o no contiene ciphertext'
    )
  }

  const nonce = envelope.subarray(NONCE_OFFSET, AUTH_TAG_OFFSET)
  const authTag = envelope.subarray(AUTH_TAG_OFFSET, CIPHERTEXT_OFFSET)
  const ciphertext = envelope.subarray(CIPHERTEXT_OFFSET)

  if (
    nonce.length !== KUBIOS_NONCE_BYTES ||
    authTag.length !== KUBIOS_AUTH_TAG_BYTES ||
    ciphertext.length === 0
  ) {
    throw new KubiosCryptoError(
      'invalid_payload',
      'El payload cifrado de Kubios tiene longitudes no válidas'
    )
  }

  return { nonce, authTag, ciphertext }
}

/**
 * Cifra un texto con el contexto indicado.
 *
 * @throws {KubiosCryptoError} si el entorno no es servidor, falta la clave o
 * es inválida, el contexto no es válido, el texto está vacío o falla el
 * cifrado.
 */
export function encryptKubiosData(
  plaintext: string,
  context: KubiosEncryptionContext,
  options: KubiosCryptoOptions = {}
): string {
  assertServerContext()

  const validatedContext = validateContext(context)
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new KubiosCryptoError(
      'invalid_plaintext',
      'El texto a cifrar de Kubios debe ser una cadena no vacía'
    )
  }

  const key = loadEncryptionKey(resolveEnv(options))
  const plaintextBuffer = Buffer.from(plaintext, 'utf8')

  try {
    const nonce = randomBytes(KUBIOS_NONCE_BYTES)
    const cipher = createCipheriv(KUBIOS_CIPHER, key, nonce, {
      authTagLength: KUBIOS_AUTH_TAG_BYTES
    })
    cipher.setAAD(buildAdditionalData(validatedContext))

    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()])
    const authTag = cipher.getAuthTag()

    if (ciphertext.length === 0 || authTag.length !== KUBIOS_AUTH_TAG_BYTES) {
      throw new KubiosCryptoError(
        'encryption_failed',
        'No se pudo generar el payload cifrado de Kubios'
      )
    }

    const envelope = Buffer.concat([
      Buffer.from([KUBIOS_KEY_VERSION]),
      nonce,
      authTag,
      ciphertext
    ])

    return envelope.toString('base64')
  } catch (error) {
    if (error instanceof KubiosCryptoError) throw error
    throw new KubiosCryptoError('encryption_failed', 'No se pudo cifrar el payload de Kubios')
  } finally {
    key.fill(0)
    plaintextBuffer.fill(0)
  }
}

/**
 * Descifra y autentica un payload con el contexto indicado.
 *
 * @throws {KubiosCryptoError} si el entorno no es servidor, el contexto no es
 * válido, el payload tiene formato o versión no admitidos, falta la clave o
 * falla la autenticación GCM.
 */
export function decryptKubiosData(
  payload: string,
  context: KubiosEncryptionContext,
  options: KubiosCryptoOptions = {}
): string {
  assertServerContext()

  const validatedContext = validateContext(context)
  const parsed = parseEnvelope(payload)
  const key = loadEncryptionKey(resolveEnv(options))
  const additionalData = buildAdditionalData(validatedContext)
  let decrypted: Buffer | null = null

  try {
    const decipher = createDecipheriv(KUBIOS_CIPHER, key, parsed.nonce, {
      authTagLength: KUBIOS_AUTH_TAG_BYTES
    })
    decipher.setAAD(additionalData)
    decipher.setAuthTag(parsed.authTag)

    decrypted = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    throw new KubiosCryptoError(
      'decryption_failed',
      'No se pudo autenticar ni descifrar el payload de Kubios'
    )
  } finally {
    key.fill(0)
    additionalData.fill(0)
    decrypted?.fill(0)
  }
}

/** Cifra un snapshot con `purpose: 'snapshot'`. */
export function encryptKubiosSnapshot(
  plaintext: string,
  scope: KubiosTeamMemberScope,
  options: KubiosCryptoOptions = {}
): string {
  return encryptKubiosData(plaintext, toScopeContext(scope, 'snapshot'), options)
}

/** Descifra un snapshot con `purpose: 'snapshot'`. */
export function decryptKubiosSnapshot(
  payload: string,
  scope: KubiosTeamMemberScope,
  options: KubiosCryptoOptions = {}
): string {
  return decryptKubiosData(payload, toScopeContext(scope, 'snapshot'), options)
}

/** Cifra un token con `purpose: 'token'`. */
export function encryptKubiosToken(
  plaintext: string,
  scope: KubiosTeamMemberScope,
  options: KubiosCryptoOptions = {}
): string {
  return encryptKubiosData(plaintext, toScopeContext(scope, 'token'), options)
}

/** Descifra un token con `purpose: 'token'`. */
export function decryptKubiosToken(
  payload: string,
  scope: KubiosTeamMemberScope,
  options: KubiosCryptoOptions = {}
): string {
  return decryptKubiosData(payload, toScopeContext(scope, 'token'), options)
}
