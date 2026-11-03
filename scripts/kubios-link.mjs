/**
 * CLI de administración del vínculo usuario de la aplicación ↔ miembro de
 * Kubios (K17/K49).
 *
 * Usa exclusivamente las RPC de K49 con identificadores explícitos:
 *
 *   node scripts/kubios-link.mjs show   --user-id <integer>
 *   node scripts/kubios-link.mjs set    --user-id <integer> --team-id <uuid> --member-id <uuid>
 *   node scripts/kubios-link.mjs revoke --user-id <integer>
 *
 * El usuario es el `UserID` integer de `public.users` de producción (cookie
 * HttpOnly), no una identidad UUID. No se infiere el vínculo por ninguna
 * identidad distinta del UserID: el UserID y los UUID de equipo/miembro llegan
 * siempre como argumentos explícitos.
 *
 * Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno ya
 * configurado; no carga .env por su cuenta. Valida antes de crear el cliente
 * que la URL sea HTTPS (HTTP solo localhost/127.0.0.1/[::1]), que no lleve
 * credenciales embebidas y que la clave sea service_role. No imprime
 * credenciales, JWT, URLs, datos personales ni mensajes crudos del servicio:
 * solo el UserID, los UUID y un resultado operativo breve.
 *
 * La lógica recibe un cliente RPC inyectable para poder probarse sin red. El
 * cliente real de Supabase se crea de forma perezosa y solo tras validar el
 * uso y la configuración.
 */

import { pathToFileURL } from 'node:url'

import { resolveKubiosSupabaseConfig } from '../src/lib/kubios-supabase-url.mjs'

const RPC = Object.freeze({
  show: 'kubios_get_user_member_link',
  set: 'kubios_assign_user_member_link',
  revoke: 'kubios_revoke_user_member_link'
})

const COMMAND_FLAGS = Object.freeze({
  show: Object.freeze(['user-id']),
  set: Object.freeze(['user-id', 'team-id', 'member-id']),
  revoke: Object.freeze(['user-id'])
})

const USAGE = [
  'Uso:',
  '  node scripts/kubios-link.mjs show   --user-id <integer>',
  '  node scripts/kubios-link.mjs set    --user-id <integer> --team-id <uuid> --member-id <uuid>',
  '  node scripts/kubios-link.mjs revoke --user-id <integer>',
  '',
  'Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.',
  'SUPABASE_URL debe ser HTTPS; HTTP solo se admite en localhost/127.0.0.1/[::1].',
  'SUPABASE_SERVICE_ROLE_KEY debe tener rol service_role; no se aceptan claves públicas.',
  '--user-id es el UserID integer canónico de public.users (1..2147483647).',
  'Solo se aceptan identificadores explícitos; no se infieren vínculos.'
].join('\n')

const INTEGER_PATTERN = /^[1-9][0-9]{0,9}$/
const MAX_POSTGRES_INTEGER = 2_147_483_647
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/

const RPC_ERROR_MESSAGES = Object.freeze({
  '23505': 'el miembro de Kubios ya está vinculado a otro usuario (23505).',
  '23503': 'el usuario no existe en public.users (23503).',
  '42501': 'permiso denegado para ejecutar la operación (42501).'
})

// Error cuyo mensaje es seguro por construcción (nunca proviene del servicio).
// Se expone en `safeMessage` para no confundirlo con mensajes crudos de error.
class KubiosLinkCliError extends Error {
  constructor(safeMessage) {
    super(safeMessage)
    this.name = 'KubiosLinkCliError'
    this.safeMessage = safeMessage
  }
}

function normalizeUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

/**
 * Acepta un entero positivo en representación decimal canónica: sin signo,
 * sin espacios, sin ceros a la izquierda y dentro del rango `integer` de
 * PostgreSQL. PostgREST devuelve un número JSON; un cliente de prueba puede
 * devolver la misma representación como cadena, que se normaliza al número.
 */
function normalizeUserId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 1 && value <= MAX_POSTGRES_INTEGER
      ? value
      : null
  }

  if (typeof value === 'string' && INTEGER_PATTERN.test(value)) {
    const parsed = Number(value)
    return parsed >= 1 && parsed <= MAX_POSTGRES_INTEGER ? parsed : null
  }

  return null
}

function flagList(flags) {
  return flags.map((flag) => `--${flag}`).join(', ')
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== 'string')) {
    return { ok: false, reason: 'argumentos inválidos.' }
  }

  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { ok: true, help: true }
  }

  const [command, ...rest] = argv
  if (!command) {
    return { ok: false, reason: 'falta el subcomando.' }
  }

  if (!Object.hasOwn(COMMAND_FLAGS, command)) {
    return { ok: false, reason: 'subcomando no reconocido.' }
  }

  const allowed = COMMAND_FLAGS[command]
  const flags = new Map()

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) {
      return { ok: false, reason: 'no se admiten argumentos posicionales.' }
    }

    const name = token.slice(2)
    if (!allowed.includes(name)) {
      return { ok: false, reason: 'opción no reconocida.' }
    }
    if (flags.has(name)) {
      return { ok: false, reason: 'opción repetida.' }
    }

    const raw = rest[index + 1]
    if (raw === undefined || raw.startsWith('--')) {
      return { ok: false, reason: `falta el valor de --${name}.` }
    }

    const normalized = name === 'user-id' ? normalizeUserId(raw) : normalizeUuid(raw)
    if (normalized === null) {
      return {
        ok: false,
        reason:
          name === 'user-id'
            ? `--${name} debe ser un entero canónico entre 1 y ${MAX_POSTGRES_INTEGER}.`
            : `--${name} debe ser un UUID válido.`
      }
    }

    flags.set(name, normalized)
    index += 1
  }

  const missing = allowed.filter((name) => !flags.has(name))
  if (missing.length > 0) {
    return { ok: false, reason: `faltan opciones obligatorias (${flagList(missing)}).` }
  }

  return { ok: true, command, args: Object.fromEntries(flags) }
}

function readConfig(env) {
  const url = typeof env?.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : ''
  const serviceRoleKey =
    typeof env?.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : ''

  if (!url || !serviceRoleKey) {
    return null
  }

  const config = resolveKubiosSupabaseConfig(url, serviceRoleKey)
  return config.ok ? { url: config.url, serviceRoleKey: config.serviceRoleKey } : null
}

function safeSqlState(error) {
  const code = error && typeof error === 'object' ? error.code : null
  return typeof code === 'string' && SQLSTATE_PATTERN.test(code) ? code : null
}

function describeRpcError(error) {
  const code = safeSqlState(error)
  if (code && Object.hasOwn(RPC_ERROR_MESSAGES, code)) {
    return RPC_ERROR_MESSAGES[code]
  }

  return code ? `la operación falló (código ${code}).` : 'la operación falló.'
}

function toRows(data) {
  if (data == null) return []
  return Array.isArray(data) ? data : [data]
}

function readLinkedRow(row, expected) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return null
  }

  const userId = normalizeUserId(row.user_id)
  const teamId = normalizeUuid(row.team_id)
  const memberId = normalizeUuid(row.kubios_member_id)

  if (userId === null || !teamId || !memberId) {
    return null
  }

  if (userId !== expected.userId) {
    return null
  }

  if (expected.teamId && teamId !== expected.teamId) {
    return null
  }

  if (expected.memberId && memberId !== expected.memberId) {
    return null
  }

  return { userId, teamId, memberId }
}

async function callRpc(client, name, params) {
  if (!client || typeof client.rpc !== 'function') {
    throw new KubiosLinkCliError('no se pudo crear el cliente de Supabase.')
  }

  let result
  try {
    result = await client.rpc(name, params)
  } catch (error) {
    throw new KubiosLinkCliError(describeRpcError(error))
  }

  if (!result || typeof result !== 'object') {
    throw new KubiosLinkCliError('respuesta inesperada del servicio.')
  }

  if (result.error) {
    throw new KubiosLinkCliError(describeRpcError(result.error))
  }

  return result.data
}

async function runCommand(client, command, args, out) {
  const userId = args['user-id']

  if (command === 'show') {
    const data = await callRpc(client, RPC.show, { p_user_id: userId })
    const rows = toRows(data)

    if (rows.length === 0) {
      out(`unlinked userId=${userId}`)
      return 0
    }

    if (rows.length > 1) {
      throw new KubiosLinkCliError('respuesta inesperada del servicio.')
    }

    const linked = readLinkedRow(rows[0], { userId })
    if (!linked) {
      throw new KubiosLinkCliError('respuesta inesperada del servicio.')
    }

    out(`linked userId=${linked.userId} teamId=${linked.teamId} memberId=${linked.memberId}`)
    return 0
  }

  if (command === 'set') {
    const teamId = args['team-id']
    const memberId = args['member-id']
    const data = await callRpc(client, RPC.set, {
      p_user_id: userId,
      p_team_id: teamId,
      p_kubios_member_id: memberId
    })

    const rows = toRows(data)
    if (rows.length !== 1) {
      throw new KubiosLinkCliError('respuesta inesperada del servicio.')
    }

    const linked = readLinkedRow(rows[0], { userId, teamId, memberId })
    if (!linked) {
      throw new KubiosLinkCliError('respuesta inesperada del servicio.')
    }

    out(`assigned userId=${linked.userId} teamId=${linked.teamId} memberId=${linked.memberId}`)
    return 0
  }

  // revoke
  const data = await callRpc(client, RPC.revoke, { p_user_id: userId })
  if (typeof data !== 'boolean') {
    throw new KubiosLinkCliError('respuesta inesperada del servicio.')
  }

  out(`${data ? 'revoked' : 'no-link'} userId=${userId}`)
  return 0
}

async function createDefaultClient({ url, serviceRoleKey }) {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  })
}

/**
 * Crea una instancia del CLI con dependencias inyectables.
 *
 * @param {object} [options]
 * @param {(config: {url: string, serviceRoleKey: string}) => unknown} [options.createClient]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(text: string) => void} [options.stdout]
 * @param {(text: string) => void} [options.stderr]
 */
export function createKubiosLinkCli(options = {}) {
  const env = options.env ?? process.env
  const createClient = options.createClient ?? createDefaultClient
  const writeStdout = options.stdout ?? ((text) => process.stdout.write(text))
  const writeStderr = options.stderr ?? ((text) => process.stderr.write(text))

  const out = (line) => writeStdout(`${line}\n`)
  const err = (line) => writeStderr(`${line}\n`)

  async function run(argv = []) {
    const parsed = parseArgs(argv)
    if (!parsed.ok) {
      err(`kubios-link: ${parsed.reason}`)
      err(USAGE)
      return 2
    }

    if (parsed.help) {
      out(USAGE)
      return 0
    }

    const config = readConfig(env)
    if (!config) {
      err(
        'kubios-link: configuración de Supabase inválida o incompleta; se requiere HTTPS (HTTP solo localhost) y una clave service_role.'
      )
      return 1
    }

    let client
    try {
      client = await createClient(config)
    } catch {
      err('kubios-link: no se pudo crear el cliente de Supabase.')
      return 1
    }

    try {
      return await runCommand(client, parsed.command, parsed.args, out)
    } catch (error) {
      const message =
        error instanceof KubiosLinkCliError ? error.safeMessage : describeRpcError(error)
      err(`kubios-link: ${message}`)
      return 1
    }
  }

  return { run }
}

/**
 * Punto de entrada programático. Devuelve el código de salida (0/1/2) en vez
 * de terminar el proceso.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const cli = createKubiosLinkCli(deps)
  return cli.run(argv)
}

function isDirectInvocation() {
  const entry = process.argv[1]
  if (!entry) return false

  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
}

if (isDirectInvocation()) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch(() => {
      process.stderr.write('kubios-link: error inesperado.\n')
      process.exitCode = 1
    })
}
