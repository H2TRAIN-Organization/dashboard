/**
 * K49 - Validación de la configuración Supabase del sync (sin red).
 *
 * El cliente de servicio no se inyecta: se comprueba que una URL o clave
 * inválida devuelve `partial` antes de cualquier fetch y que un HTTP remoto,
 * credenciales embebidas o una clave anónima no llegan a crear el cliente.
 *
 * Ejecutar:
 *   node --conditions=react-server --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --test tests/kubios-sync-config.k49.test.mjs
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./kubios-sync.k14.loader.mjs', import.meta.url))

const { runKubiosSync } = await import('../src/lib/kubios-sync.ts')
const {
  isKubiosServiceRoleKey,
  normalizeKubiosSupabaseUrl,
  resolveKubiosSupabaseConfig
} = await import('../src/lib/kubios-supabase-url.ts')

const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const KEY = Buffer.alloc(32, 0x5a)

function syntheticJwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url'
  )
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url')
  return `${header}.${payload}.synthetic-signature`
}

const SERVICE_KEY = syntheticJwt('service_role')
const ANON_KEY = syntheticJwt('anon')

const BASE_ENV = Object.freeze({
  KUBIOS_USERNAME: 'usuario.sintetico@example.invalid',
  KUBIOS_PASSWORD: 'synthetic-password',
  KUBIOS_CLIENT_ID: 'cliente-sintetico',
  KUBIOS_TEAM_ID: TEAM_ID,
  KUBIOS_ENCRYPTION_KEY_V1: KEY.toString('base64'),
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY
})

test('URL: acepta HTTPS y HTTP solo en hosts locales exactos', () => {
  for (const url of [
    'https://synthetic.invalid',
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321'
  ]) {
    assert.equal(normalizeKubiosSupabaseUrl(url), url)
  }

  for (const url of [
    'http://synthetic.invalid',
    'http://localhost.evil.invalid',
    'http://127.0.0.1.evil.invalid',
    'ftp://synthetic.invalid',
    'file:///tmp/supabase',
    'not a url',
    'https://user:password@synthetic.invalid',
    'https://user@synthetic.invalid',
    ''
  ]) {
    assert.equal(normalizeKubiosSupabaseUrl(url), null, `${url} debe rechazarse`)
  }
})

test('clave: acepta service_role y sb_secret_, rechaza anon y valores vacíos', () => {
  assert.equal(isKubiosServiceRoleKey(SERVICE_KEY), true)
  assert.equal(isKubiosServiceRoleKey(`sb_secret_${'x'.repeat(24)}`), true)
  assert.equal(isKubiosServiceRoleKey(ANON_KEY), false)
  assert.equal(isKubiosServiceRoleKey(''), false)
  assert.equal(isKubiosServiceRoleKey('synthetic-service-role-not-real'), false)
})

test('configuración: devuelve ok solo con URL y clave válidas, sin eco de valores', () => {
  const valid = resolveKubiosSupabaseConfig(
    'http://localhost:54321',
    SERVICE_KEY
  )
  assert.deepEqual(valid, {
    ok: true,
    url: 'http://localhost:54321',
    serviceRoleKey: SERVICE_KEY
  })

  const invalidUrl = resolveKubiosSupabaseConfig(
    'https://user:secret@synthetic.invalid',
    SERVICE_KEY
  )
  assert.deepEqual(invalidUrl, { ok: false, reason: 'url' })
  assert.equal(JSON.stringify(invalidUrl).includes('secret'), false)

  const invalidKey = resolveKubiosSupabaseConfig('https://synthetic.invalid', ANON_KEY)
  assert.deepEqual(invalidKey, { ok: false, reason: 'service-role-key' })
  assert.equal(JSON.stringify(invalidKey).includes(ANON_KEY), false)
})

test('sync: URL remota HTTP, credenciales o protocolo no HTTP no hacen fetch ni crean cliente', async () => {
  for (const url of [
    'http://synthetic.invalid',
    'https://user:password@synthetic.invalid',
    'ftp://synthetic.invalid',
    'not a url'
  ]) {
    let fetchCalls = 0
    const result = await runKubiosSync({
      env: { ...BASE_ENV, SUPABASE_URL: url },
      apiFetch: async () => {
        fetchCalls += 1
        throw new Error('fetch no permitido')
      },
      authFetch: async () => {
        fetchCalls += 1
        throw new Error('fetch no permitido')
      }
    })

    assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
    assert.equal(fetchCalls, 0, `${url} no debe disparar fetch`)
  }
})

test('sync: clave anónima no dispara fetch con URL válida', async () => {
  let fetchCalls = 0
  const result = await runKubiosSync({
    env: {
      ...BASE_ENV,
      SUPABASE_URL: 'https://synthetic.invalid',
      SUPABASE_SERVICE_ROLE_KEY: ANON_KEY
    },
    apiFetch: async () => {
      fetchCalls += 1
      throw new Error('fetch no permitido')
    },
    authFetch: async () => {
      fetchCalls += 1
      throw new Error('fetch no permitido')
    }
  })

  assert.deepEqual(result, { status: 'partial', synced: 0, failed: 1 })
  assert.equal(fetchCalls, 0)
})
