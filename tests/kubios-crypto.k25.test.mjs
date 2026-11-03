/**
 * Pruebas sintéticas de src/lib/kubios-crypto.ts (subtarea K25).
 *
 * El módulo importa `server-only`, cuyo export `react-server` es un módulo
 * vacío. Por eso las pruebas se ejecutan con `--conditions=react-server`, sin
 * modificar el guard de producción ni el módulo fuente:
 *
 *   node --conditions=react-server \
 *     --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --test tests/kubios-crypto.k25.test.mjs
 *
 * Node 24 transpila el TypeScript del módulo al vuelo (type stripping nativo).
 * No se usan claves, textos ni identificadores reales. La suite es hermética:
 * todas las operaciones reciben `{ env }` explícito; el único uso de
 * `process.env` es una clave sintética que se restaura en `finally`.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inspect } from 'node:util'

import {
  KUBIOS_AUTH_TAG_BYTES,
  KUBIOS_ENCRYPTION_KEY_ENV,
  KUBIOS_KEY_VERSION,
  KUBIOS_NONCE_BYTES,
  KubiosCryptoError,
  decryptKubiosData,
  decryptKubiosSnapshot,
  decryptKubiosToken,
  encryptKubiosData,
  encryptKubiosSnapshot,
  encryptKubiosToken
} from '../src/lib/kubios-crypto.ts'

const KEY_A = Buffer.alloc(32, 0x6b)
const KEY_B = Buffer.alloc(32, 0x7a)
const KEY_A_B64 = KEY_A.toString('base64')
const KEY_B_B64 = KEY_B.toString('base64')

const ENV_A = Object.freeze({ [KUBIOS_ENCRYPTION_KEY_ENV]: KEY_A_B64 })
const ENV_B = Object.freeze({ [KUBIOS_ENCRYPTION_KEY_ENV]: KEY_B_B64 })
const ENV_MISSING = Object.freeze({})
const ENV_INVALID = Object.freeze({ [KUBIOS_ENCRYPTION_KEY_ENV]: 'no-es-base64' })

const TEAM_ID = 'team-synth-k25'
const MEMBER_ID = 'member-synth-k25'
const CONTEXT = Object.freeze({ teamId: TEAM_ID, memberId: MEMBER_ID, purpose: 'snapshot' })

const PLAINTEXT_MARKER = 'SYNTH_PLAINTEXT_DO_NOT_USE'
const PLAINTEXT_UTF8 = `${PLAINTEXT_MARKER} · año≠año · 日本語 · 🔐`

function decodeEnvelope(payload) {
  return Buffer.from(payload, 'base64')
}

function encodeEnvelope({ version = KUBIOS_KEY_VERSION, nonce, authTag, ciphertext }) {
  return Buffer.concat([Buffer.from([version]), nonce, authTag, ciphertext]).toString('base64')
}

function flipBit(payload, offset) {
  const envelope = decodeEnvelope(payload)
  envelope[offset] ^= 0x01
  return envelope.toString('base64')
}

function captureError(fn) {
  try {
    fn()
  } catch (error) {
    return error
  }

  assert.fail('Se esperaba un KubiosCryptoError y no se lanzó ningún error')
}

function assertKubiosError(error, expectedCode) {
  assert.ok(error instanceof KubiosCryptoError, `Se esperaba KubiosCryptoError, recibido: ${inspect(error)}`)
  assert.equal(error.name, 'KubiosCryptoError')
  assert.equal(error.code, expectedCode)
  assert.equal(typeof error.message, 'string')
  assert.ok(error.message.length > 0, 'El error controlado debe tener un mensaje')
}

function encryptSynthetic(plaintext = PLAINTEXT_MARKER, context = CONTEXT, env = ENV_A) {
  return encryptKubiosData(plaintext, context, { env })
}

describe('K25 kubios-crypto (datos 100% sintéticos)', () => {
  describe('1. roundtrip AES-GCM', () => {
    it('cifra y descifra texto ASCII sintético', () => {
      const payload = encryptSynthetic()

      assert.equal(typeof payload, 'string')
      assert.ok(payload.length > 0)
      assert.equal(decryptKubiosData(payload, CONTEXT, { env: ENV_A }), PLAINTEXT_MARKER)
    })

    it('cifra y descifra UTF-8 multibyte sin corromper el texto', () => {
      const payload = encryptSynthetic(PLAINTEXT_UTF8)
      const envelope = decodeEnvelope(payload)

      assert.equal(decryptKubiosData(payload, CONTEXT, { env: ENV_A }), PLAINTEXT_UTF8)
      assert.equal(
        envelope.subarray(KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES + 1).length,
        Buffer.byteLength(PLAINTEXT_UTF8, 'utf8')
      )
    })

    it('rechaza la cadena vacía: el módulo no permite cifrarla', () => {
      const error = captureError(() => encryptSynthetic(''))

      assertKubiosError(error, 'invalid_plaintext')
    })

    it('conserva el roundtrip en los helpers de snapshot y token', () => {
      const scope = { teamId: TEAM_ID, memberId: MEMBER_ID }
      const snapshot = encryptKubiosSnapshot(PLAINTEXT_MARKER, scope, { env: ENV_A })
      const token = encryptKubiosToken(PLAINTEXT_MARKER, scope, { env: ENV_A })

      assert.equal(decryptKubiosSnapshot(snapshot, scope, { env: ENV_A }), PLAINTEXT_MARKER)
      assert.equal(decryptKubiosToken(token, scope, { env: ENV_A }), PLAINTEXT_MARKER)
    })
  })

  describe('2. nonce aleatorio', () => {
    it('dos cifrados del mismo texto producen payload y nonce distintos', () => {
      const first = encryptSynthetic()
      const second = encryptSynthetic()

      const firstEnvelope = decodeEnvelope(first)
      const secondEnvelope = decodeEnvelope(second)

      assert.notEqual(first, second)
      assert.notDeepEqual(
        firstEnvelope.subarray(1, 1 + KUBIOS_NONCE_BYTES),
        secondEnvelope.subarray(1, 1 + KUBIOS_NONCE_BYTES)
      )
      assert.notDeepEqual(
        firstEnvelope.subarray(1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES),
        secondEnvelope.subarray(1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES)
      )
    })

    it('usa versión 1, nonce de 12 bytes, tag de 16 bytes y ciphertext no vacío', () => {
      const envelope = decodeEnvelope(encryptSynthetic())

      assert.equal(envelope.readUInt8(0), KUBIOS_KEY_VERSION)
      assert.equal(KUBIOS_KEY_VERSION, 1)
      assert.equal(KUBIOS_NONCE_BYTES, 12)
      assert.equal(KUBIOS_AUTH_TAG_BYTES, 16)

      const nonce = envelope.subarray(1, 1 + KUBIOS_NONCE_BYTES)
      const authTag = envelope.subarray(
        1 + KUBIOS_NONCE_BYTES,
        1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES
      )
      const ciphertext = envelope.subarray(1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES)

      assert.equal(nonce.length, KUBIOS_NONCE_BYTES)
      assert.equal(authTag.length, KUBIOS_AUTH_TAG_BYTES)
      assert.ok(ciphertext.length > 0)
    })

    it('genera nonces distintos en cifrados consecutivos', () => {
      const nonces = new Set()
      for (let index = 0; index < 16; index += 1) {
        nonces.add(decodeEnvelope(encryptSynthetic()).subarray(1, 1 + KUBIOS_NONCE_BYTES).toString('hex'))
      }

      assert.equal(nonces.size, 16)
    })
  })

  describe('3. AAD ligado a teamId, memberId y purpose', () => {
    it('descifra con el mismo contexto y falla al alterar teamId', () => {
      const payload = encryptSynthetic()

      assert.equal(decryptKubiosData(payload, CONTEXT, { env: ENV_A }), PLAINTEXT_MARKER)
      const error = captureError(() =>
        decryptKubiosData(payload, { ...CONTEXT, teamId: `${TEAM_ID}-alterado` }, { env: ENV_A })
      )

      assertKubiosError(error, 'decryption_failed')
    })

    it('falla al alterar memberId', () => {
      const payload = encryptSynthetic()
      const error = captureError(() =>
        decryptKubiosData(payload, { ...CONTEXT, memberId: `${MEMBER_ID}-alterado` }, { env: ENV_A })
      )

      assertKubiosError(error, 'decryption_failed')
    })

    it('falla al cambiar purpose de snapshot a token', () => {
      const payload = encryptSynthetic()
      const error = captureError(() => decryptKubiosData(payload, { ...CONTEXT, purpose: 'token' }, { env: ENV_A }))

      assertKubiosError(error, 'decryption_failed')
    })

    it('separa los helpers de snapshot y token aunque compartan equipo y miembro', () => {
      const scope = { teamId: TEAM_ID, memberId: MEMBER_ID }
      const snapshot = encryptKubiosSnapshot(PLAINTEXT_MARKER, scope, { env: ENV_A })

      const error = captureError(() => decryptKubiosToken(snapshot, scope, { env: ENV_A }))

      assertKubiosError(error, 'decryption_failed')
    })
  })

  describe('4. clave incorrecta', () => {
    it('falla al descifrar con otra clave de 32 bytes', () => {
      const payload = encryptSynthetic()
      const error = captureError(() => decryptKubiosData(payload, CONTEXT, { env: ENV_B }))

      assertKubiosError(error, 'decryption_failed')
    })

    it('falla al cruzar payload de una clave con la otra aunque el contexto sea idéntico', () => {
      const payloadFromB = encryptSynthetic(PLAINTEXT_MARKER, CONTEXT, ENV_B)
      const error = captureError(() => decryptKubiosData(payloadFromB, CONTEXT, { env: ENV_A }))

      assertKubiosError(error, 'decryption_failed')
    })
  })

  describe('5. tag, nonce o ciphertext alterados', () => {
    it('falla si se altera un bit del auth tag', () => {
      const payload = encryptSynthetic()
      const tampered = flipBit(payload, 1 + KUBIOS_NONCE_BYTES)

      assert.notEqual(tampered, payload)
      assertKubiosError(captureError(() => decryptKubiosData(tampered, CONTEXT, { env: ENV_A })), 'decryption_failed')
    })

    it('falla si se altera un bit del ciphertext', () => {
      const payload = encryptSynthetic()
      const tampered = flipBit(payload, 1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES)

      assert.notEqual(tampered, payload)
      assertKubiosError(captureError(() => decryptKubiosData(tampered, CONTEXT, { env: ENV_A })), 'decryption_failed')
    })

    it('falla si se altera un bit del nonce', () => {
      const payload = encryptSynthetic()
      const tampered = flipBit(payload, 1)

      assert.notEqual(tampered, payload)
      assertKubiosError(captureError(() => decryptKubiosData(tampered, CONTEXT, { env: ENV_A })), 'decryption_failed')
    })

    it('falla si se intercambian auth tag y ciphertext de otro payload', () => {
      const first = decodeEnvelope(encryptSynthetic())
      const second = decodeEnvelope(encryptSynthetic())
      const mixed = encodeEnvelope({
        nonce: first.subarray(1, 1 + KUBIOS_NONCE_BYTES),
        authTag: first.subarray(
          1 + KUBIOS_NONCE_BYTES,
          1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES
        ),
        ciphertext: second.subarray(1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES)
      })

      assertKubiosError(captureError(() => decryptKubiosData(mixed, CONTEXT, { env: ENV_A })), 'decryption_failed')
    })
  })

  describe('6. entradas inválidas', () => {
    it('rechaza payloads que no son cadenas o están vacíos', () => {
      for (const payload of [undefined, null, 0, 42, true, {}, [], '']) {
        assertKubiosError(captureError(() => decryptKubiosData(payload, CONTEXT, { env: ENV_A })), 'invalid_payload')
      }
    })

    it('rechaza base64 inválido o no canónico', () => {
      for (const payload of ['no-es-base64!!!', 'abc', 'A===', 'AAAAA', '====', ' a2tr ']) {
        assertKubiosError(captureError(() => decryptKubiosData(payload, CONTEXT, { env: ENV_A })), 'invalid_payload')
      }

      // 'a2t=', 'a2u=' y 'a2v=' decodifican a los mismos dos bytes que la forma
      // canónica 'a2s=' (0x6b6b), pero no re-codifican igual. El módulo exige
      // round-trip base64 idéntico, así que debe rechazarlas como no canónicas
      // antes de interpretar la versión del sobre.
      const canonicalBytes = Buffer.from('a2s=', 'base64')
      for (const payload of ['a2t=', 'a2u=', 'a2v=']) {
        assert.deepEqual(Buffer.from(payload, 'base64'), canonicalBytes)
        assert.notEqual(Buffer.from(payload, 'base64').toString('base64'), payload)
        assertKubiosError(captureError(() => decryptKubiosData(payload, CONTEXT, { env: ENV_A })), 'invalid_payload')
      }
    })

    it('rechaza sobres truncados sin nonce, tag o ciphertext completos', () => {
      const valid = decodeEnvelope(encryptSynthetic())
      const truncatedCases = [
        Buffer.from([KUBIOS_KEY_VERSION]).toString('base64'),
        valid.subarray(0, 1 + KUBIOS_NONCE_BYTES).toString('base64'),
        valid.subarray(0, 1 + KUBIOS_NONCE_BYTES + KUBIOS_AUTH_TAG_BYTES - 1).toString('base64')
      ]

      for (const payload of truncatedCases) {
        assertKubiosError(captureError(() => decryptKubiosData(payload, CONTEXT, { env: ENV_A })), 'invalid_payload')
      }
    })

    it('rechaza versiones desconocidas antes de intentar descifrar', () => {
      for (const version of [0, 2, 255]) {
        const payload = encodeEnvelope({ version, nonce: Buffer.alloc(12, 1), authTag: Buffer.alloc(16, 2), ciphertext: Buffer.from('x') })
        assertKubiosError(captureError(() => decryptKubiosData(payload, CONTEXT, { env: ENV_A })), 'unsupported_version')
      }
    })

    it('rechaza contextos inválidos', () => {
      const invalidContexts = [
        null,
        {},
        { ...CONTEXT, teamId: '' },
        { ...CONTEXT, teamId: '   ' },
        { ...CONTEXT, memberId: '' },
        { ...CONTEXT, memberId: '\t' },
        { ...CONTEXT, purpose: 'otro' },
        { ...CONTEXT, purpose: undefined }
      ]

      for (const context of invalidContexts) {
        assertKubiosError(
          captureError(() => encryptKubiosData(PLAINTEXT_MARKER, context, { env: ENV_A })),
          'invalid_context'
        )
        assertKubiosError(
          captureError(() => decryptKubiosData(encryptSynthetic(), context, { env: ENV_A })),
          'invalid_context'
        )
      }

      assertKubiosError(
        captureError(() => encryptKubiosSnapshot(PLAINTEXT_MARKER, null, { env: ENV_A })),
        'invalid_context'
      )
    })

    it('rechaza texto plano vacío o que no es cadena', () => {
      for (const plaintext of ['', undefined, null, 42, {}]) {
        assertKubiosError(
          captureError(() => encryptKubiosData(plaintext, CONTEXT, { env: ENV_A })),
          'invalid_plaintext'
        )
      }
    })

    it('rechaza clave ausente, vacía o con formato incorrecto y aísla process.env', () => {
      for (const env of [ENV_MISSING, { [KUBIOS_ENCRYPTION_KEY_ENV]: '' }, { [KUBIOS_ENCRYPTION_KEY_ENV]: '   ' }]) {
        assertKubiosError(captureError(() => encryptSynthetic(PLAINTEXT_MARKER, CONTEXT, env)), 'missing_key')
      }

      const invalidKeys = [
        'no-es-base64',
        Buffer.alloc(16, 0x6b).toString('base64'),
        Buffer.alloc(31, 0x6b).toString('base64'),
        Buffer.alloc(33, 0x6b).toString('base64'),
        `${KEY_A_B64}=`
      ]

      for (const invalidKey of invalidKeys) {
        const error = captureError(() =>
          encryptSynthetic(PLAINTEXT_MARKER, CONTEXT, { [KUBIOS_ENCRYPTION_KEY_ENV]: invalidKey })
        )
        assertKubiosError(error, 'invalid_key')
        assert.ok(!error.message.includes(invalidKey))
      }

      // Hermeticidad: con una clave sintética válida en process.env, las
      // opciones `env` explícitas deben seguir mandando. Se restaura el valor
      // previo (o se elimina) sin registrar nunca su contenido.
      const previousAmbientKey = process.env[KUBIOS_ENCRYPTION_KEY_ENV]
      process.env[KUBIOS_ENCRYPTION_KEY_ENV] = KEY_A_B64
      try {
        assertKubiosError(
          captureError(() => encryptSynthetic(PLAINTEXT_MARKER, CONTEXT, ENV_INVALID)),
          'invalid_key'
        )
        assertKubiosError(
          captureError(() => encryptSynthetic(PLAINTEXT_MARKER, CONTEXT, ENV_MISSING)),
          'missing_key'
        )
        const payload = encryptSynthetic()
        assertKubiosError(captureError(() => decryptKubiosData(payload, CONTEXT, { env: ENV_B })), 'decryption_failed')
      } finally {
        if (previousAmbientKey === undefined) {
          delete process.env[KUBIOS_ENCRYPTION_KEY_ENV]
        } else {
          process.env[KUBIOS_ENCRYPTION_KEY_ENV] = previousAmbientKey
        }
      }
    })
  })

  describe('7. no fuga de clave, texto plano ni contexto', () => {
    it('los errores controlados no contienen secretos ni fragmentos identificables', () => {
      const validPayload = encryptSynthetic()
      const tamperedPayload = flipBit(validPayload, 1 + KUBIOS_NONCE_BYTES)
      const unknownVersionPayload = encodeEnvelope({
        version: 99,
        nonce: Buffer.alloc(12, 3),
        authTag: Buffer.alloc(16, 4),
        ciphertext: Buffer.from('x')
      })

      const operations = [
        {
          code: 'decryption_failed',
          run: () => decryptKubiosData(validPayload, CONTEXT, { env: ENV_B })
        },
        {
          code: 'decryption_failed',
          run: () => decryptKubiosData(validPayload, { ...CONTEXT, teamId: `${TEAM_ID}-otro` }, { env: ENV_A })
        },
        {
          code: 'decryption_failed',
          run: () => decryptKubiosData(tamperedPayload, CONTEXT, { env: ENV_A })
        },
        {
          code: 'invalid_payload',
          run: () => decryptKubiosData('base64-invalido!!!', CONTEXT, { env: ENV_A })
        },
        {
          code: 'unsupported_version',
          run: () => decryptKubiosData(unknownVersionPayload, CONTEXT, { env: ENV_A })
        },
        {
          code: 'missing_key',
          run: () => encryptKubiosData(PLAINTEXT_MARKER, CONTEXT, { env: ENV_MISSING })
        },
        {
          code: 'invalid_key',
          run: () => encryptKubiosData(PLAINTEXT_MARKER, CONTEXT, { env: ENV_INVALID })
        },
        {
          code: 'invalid_plaintext',
          run: () => encryptKubiosData('', CONTEXT, { env: ENV_A })
        }
      ]

      const forbidden = [
        KEY_A_B64,
        KEY_B_B64,
        KEY_A.toString('hex'),
        KEY_B.toString('hex'),
        PLAINTEXT_MARKER,
        'SYNTH_PLAINTEXT',
        PLAINTEXT_UTF8,
        TEAM_ID,
        MEMBER_ID,
        validPayload,
        tamperedPayload
      ]

      for (const { code, run } of operations) {
        const error = captureError(run)

        assertKubiosError(error, code)
        assert.equal(error.cause, undefined)

        const surface = [error.message, String(error), error.stack ?? '', inspect(error, { depth: 5 })].join('\n')
        for (const secret of forbidden) {
          assert.ok(
            !surface.includes(secret),
            `El error ${error.code} filtró un valor sintético prohibido: ${secret.slice(0, 24)}…`
          )
        }
      }
    })

    it('mantiene mensajes genéricos por código de error', () => {
      const wrongKey = captureError(() => decryptKubiosData(encryptSynthetic(), CONTEXT, { env: ENV_B }))
      const badPayload = captureError(() => decryptKubiosData('base64-invalido!!!', CONTEXT, { env: ENV_A }))

      assertKubiosError(wrongKey, 'decryption_failed')
      assertKubiosError(badPayload, 'invalid_payload')
      assert.equal(wrongKey.message, 'No se pudo autenticar ni descifrar el payload de Kubios')
      assert.equal(badPayload.message, 'El payload cifrado de Kubios no es base64 válido')
    })
  })
})
