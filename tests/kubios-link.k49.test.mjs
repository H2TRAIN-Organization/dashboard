/**
 * Pruebas locales de scripts/kubios-link.mjs (K49).
 *
 * No hay red ni Supabase real: el cliente RPC se inyecta y solo se comprueba
 * el contrato del CLI. El usuario debe ser el `UserID` integer canonico de
 * public.users; no se acepta UUID de auth.users ni se infiere por email.
 *
 * Ejecutar:
 *   node --test tests/kubios-link.k49.test.mjs
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'

const { createKubiosLinkCli } = await import('../scripts/kubios-link.mjs')

const TEAM_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function syntheticJwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url'
  )
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url')
  return `${header}.${payload}.synthetic-signature`
}

const SERVICE_KEY = syntheticJwt('service_role')
const ENV = Object.freeze({
  SUPABASE_URL: 'https://synthetic.invalid',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY
})

function fakeClient(result) {
  const calls = []
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params })
      if (result instanceof Error) throw result
      return result
    }
  }
}

async function runCli(argv, { client, env = ENV } = {}) {
  const stdout = []
  const stderr = []
  const cli = createKubiosLinkCli({
    env,
    createClient: async () => client,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text)
  })

  const code = await cli.run(argv)
  return { code, stdout: stdout.join(''), stderr: stderr.join('') }
}

test('CLI: la ayuda usa --user-id integer y no auth-user-id', async () => {
  const { code, stdout, stderr } = await runCli(['--help'])
  assert.equal(code, 0)
  assert.equal(stderr, '')
  assert.match(stdout, /--user-id <integer>/)
  assert.doesNotMatch(stdout, /auth-user-id/)
  assert.match(stdout, /UserID integer/)
  assert.match(stdout, /no se infieren vínculos/i)
})

test('CLI: rechaza el flag antiguo --auth-user-id sin crear cliente', async () => {
  let created = false
  const cli = createKubiosLinkCli({
    env: ENV,
    createClient: async () => {
      created = true
      return fakeClient({ data: [] })
    },
    stdout: () => {},
    stderr: () => {}
  })

  const code = await cli.run(['show', '--auth-user-id', '2001'])
  assert.equal(code, 2)
  assert.equal(created, false)
})

test('CLI: rechaza UserID no canónicos antes de llamar a la RPC', async () => {
  for (const invalid of ['0', '01', '+1', '-1', '1.0', ' 1', '2147483648', 'abc', '1e3']) {
    const client = fakeClient({ data: [] })
    const { code, stderr } = await runCli(['show', '--user-id', invalid], { client })
    assert.equal(code, 2, `--user-id ${JSON.stringify(invalid)} debe rechazarse`)
    assert.match(stderr, /entero canónico/)
    assert.equal(client.calls.length, 0)
  }
})

test('CLI: show sin vínculo llama con p_user_id numérico y no imprime UUID', async () => {
  const client = fakeClient({ data: [] })
  const { code, stdout, stderr } = await runCli(['show', '--user-id', '2001'], { client })

  assert.equal(code, 0)
  assert.equal(stderr, '')
  assert.deepEqual(client.calls, [
    { name: 'kubios_get_user_member_link', params: { p_user_id: 2001 } }
  ])
  assert.equal(stdout, 'unlinked userId=2001\n')
})

test('CLI: show con vínculo acepta user_id integer y muestra IDs explícitos', async () => {
  const client = fakeClient({
    data: [
      {
        user_id: 2001,
        team_id: TEAM_ID,
        kubios_member_id: MEMBER_ID,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    ]
  })
  const { code, stdout } = await runCli(['show', '--user-id', '2001'], { client })

  assert.equal(code, 0)
  assert.equal(stdout, `linked userId=2001 teamId=${TEAM_ID} memberId=${MEMBER_ID}\n`)
})

test('CLI: set envía p_user_id integer y UUID normalizados', async () => {
  const client = fakeClient({
    data: [
      {
        user_id: 2001,
        team_id: TEAM_ID,
        kubios_member_id: MEMBER_ID,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    ]
  })
  const { code, stdout } = await runCli(
    [
      'set',
      '--user-id',
      '2001',
      '--team-id',
      TEAM_ID.toUpperCase(),
      '--member-id',
      MEMBER_ID
    ],
    { client }
  )

  assert.equal(code, 0)
  assert.deepEqual(client.calls, [
    {
      name: 'kubios_assign_user_member_link',
      params: {
        p_user_id: 2001,
        p_team_id: TEAM_ID,
        p_kubios_member_id: MEMBER_ID
      }
    }
  ])
  assert.equal(stdout, `assigned userId=2001 teamId=${TEAM_ID} memberId=${MEMBER_ID}\n`)
})

test('CLI: revoke usa p_user_id integer y devuelve el resultado booleano', async () => {
  const client = fakeClient({ data: true })
  const { code, stdout } = await runCli(['revoke', '--user-id', '2001'], { client })

  assert.equal(code, 0)
  assert.deepEqual(client.calls, [
    { name: 'kubios_revoke_user_member_link', params: { p_user_id: 2001 } }
  ])
  assert.equal(stdout, 'revoked userId=2001\n')
})

test('CLI: un 23503 se explica como usuario ausente en public.users', async () => {
  const client = fakeClient({ error: { code: '23503' } })
  const { code, stderr } = await runCli(['show', '--user-id', '9999'], { client })

  assert.equal(code, 1)
  assert.match(stderr, /public\.users/)
  assert.doesNotMatch(stderr, /auth\.users/)
})

test('CLI: una respuesta con user_id UUID se rechaza como inesperada', async () => {
  const client = fakeClient({
    data: [
      {
        user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        team_id: TEAM_ID,
        kubios_member_id: MEMBER_ID
      }
    ]
  })
  const { code, stderr } = await runCli(['show', '--user-id', '2001'], { client })

  assert.equal(code, 1)
  assert.match(stderr, /respuesta inesperada/)
})

test('CLI: acepta HTTP solo para localhost/127.0.0.1/[::1] y crea el cliente inyectado', async () => {
  for (const url of [
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321'
  ]) {
    const client = fakeClient({ data: [] })
    const { code, stderr } = await runCli(['show', '--user-id', '2001'], {
      client,
      env: { ...ENV, SUPABASE_URL: url }
    })

    assert.equal(code, 0, `${url} debe aceptarse en local`)
    assert.equal(stderr, '')
    assert.equal(client.calls.length, 1)
  }
})

test('CLI: rechaza URL inseguras o con credenciales antes de crear el cliente', async () => {
  const invalidUrls = [
    'http://synthetic.invalid',
    'http://127.0.0.1.evil.invalid',
    'http://localhost.evil.invalid',
    'ftp://synthetic.invalid',
    'file:///tmp/supabase',
    'not a url',
    'https://user:password@synthetic.invalid',
    'https://user@synthetic.invalid'
  ]

  for (const url of invalidUrls) {
    let created = false
    const stderr = []
    const code = await createKubiosLinkCli({
      env: { ...ENV, SUPABASE_URL: url },
      createClient: async () => {
        created = true
        return fakeClient({ data: [] })
      },
      stdout: () => {},
      stderr: (text) => stderr.push(text)
    }).run(['show', '--user-id', '2001'])

    assert.equal(code, 1, `${url} debe rechazarse`)
    assert.equal(created, false, `${url} no debe crear cliente`)
    const message = stderr.join('')
    assert.match(message, /configuración de Supabase inválida o incompleta/)
    assert.doesNotMatch(message, /synthetic\.invalid|password|not a url|file:/)
  }
})

test('CLI: rechaza una clave que no sea service_role antes de crear el cliente', async () => {
  let created = false
  const anonKey = syntheticJwt('anon')
  const stderr = []
  const code = await createKubiosLinkCli({
    env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: anonKey },
    createClient: async () => {
      created = true
      return fakeClient({ data: [] })
    },
    stdout: () => {},
    stderr: (text) => stderr.push(text)
  }).run(['show', '--user-id', '2001'])

  assert.equal(code, 1)
  assert.equal(created, false)
  assert.match(stderr.join(''), /configuración de Supabase inválida o incompleta/)
  assert.doesNotMatch(stderr.join(''), new RegExp(anonKey))
})
