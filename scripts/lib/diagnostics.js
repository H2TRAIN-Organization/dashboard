'use strict'

const fs = require('node:fs')
const path = require('node:path')

function requireNode24() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10)
  if (major < 24 || typeof process.loadEnvFile !== 'function') {
    console.error('NODE: se requiere Node 24 o superior')
    process.exit(1)
  }
}

function parseArgs(argv) {
  const options = { envFile: '.env.local', live: false, help: false, unknown: [] }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--live') {
      options.live = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--env') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        options.unknown.push('--env')
      } else {
        options.envFile = value
        index += 1
      }
    } else if (arg.startsWith('--env=')) {
      const value = arg.slice('--env='.length)
      if (value.length === 0) {
        options.unknown.push('--env')
      } else {
        options.envFile = value
      }
    } else {
      options.unknown.push(arg)
    }
  }

  return options
}

/**
 * Official Node 24 loader. It never parses the file manually and never echoes
 * values or loader errors.
 */
function loadEnvFile(envFile) {
  const resolved = path.resolve(process.cwd(), envFile)
  const label = path.basename(envFile) || '.env.local'
  try {
    fs.accessSync(resolved, fs.constants.R_OK)
  } catch (error) {
    const reason = error && error.code === 'ENOENT' ? 'missing' : 'unreadable'
    return { loaded: false, label, reason }
  }
  try {
    process.loadEnvFile(resolved)
    return { loaded: true, label, reason: 'loaded' }
  } catch {
    return { loaded: false, label, reason: 'unreadable' }
  }
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}

function parseSupabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, status: 'missing' }
  }

  let url
  try {
    url = new URL(value)
  } catch {
    return { ok: false, status: 'invalid-url' }
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, status: 'invalid-credentials' }
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return { ok: false, status: 'invalid-path' }
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return { ok: false, status: 'invalid-path' }
  }

  const hostname = url.hostname.toLowerCase()

  if (url.protocol === 'https:') {
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(hostname)
    if (match === null) return { ok: false, status: 'invalid-host' }
    if (url.port.length > 0) return { ok: false, status: 'invalid-port' }
    return {
      ok: true,
      status: 'supabase-cloud',
      kind: 'supabase',
      projectRef: match[1],
    }
  }

  if (url.protocol === 'http:') {
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') {
      return { ok: false, status: 'insecure-remote' }
    }
    return {
      ok: true,
      status: 'loopback',
      kind: 'loopback',
      projectRef: null,
    }
  }

  return { ok: false, status: 'invalid-protocol' }
}

function validateSupabaseUrl(value) {
  return parseSupabaseUrl(value)
}

function projectRefFromUrl(value) {
  const parsed = parseSupabaseUrl(value)
  return parsed.ok && parsed.kind === 'supabase' ? parsed.projectRef : null
}

function validatePublicKey(value, projectRef) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, status: 'missing' }
  }
  if (value.startsWith('sb_publishable_')) {
    return { ok: true, status: 'public' }
  }

  const payload = decodeJwtPayload(value)
  if (payload === null) return { ok: false, status: 'invalid' }
  if (payload.role !== 'anon') return { ok: false, status: 'not-public' }
  if (projectRef !== null && payload.ref !== projectRef) {
    return { ok: false, status: 'project-mismatch' }
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    return { ok: false, status: 'expired' }
  }
  return { ok: true, status: 'public' }
}

function validatePrivateKey(value, projectRef) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, status: 'missing' }
  }
  if (value.startsWith('sb_secret_')) {
    // Modern opaque secret key: private by class, but its role/ref cannot be
    // verified locally. Admitted for runtime auth/persistence.
    return { ok: true, status: 'private-opaque' }
  }

  const payload = decodeJwtPayload(value)
  if (payload === null) return { ok: false, status: 'invalid' }
  if (payload.role !== 'service_role') {
    return {
      ok: false,
      status: payload.role === 'anon' ? 'not-private' : 'unexpected-role',
    }
  }
  if (projectRef !== null && payload.ref !== projectRef) {
    return {
      ok: false,
      status: payload.ref === undefined ? 'missing-project-claim' : 'project-mismatch',
    }
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    return { ok: false, status: 'expired' }
  }
  return { ok: true, status: 'validated' }
}

/**
 * Shared private-key policy: SUPABASE_SERVICE_ROLE_KEY wins; the alternative
 * SUPABASE_SECRET_KEY is accepted only when it is private. The selected value
 * is never returned or printed.
 */
function inspectPrivateKeys(projectRef) {
  const service = validatePrivateKey(process.env.SUPABASE_SERVICE_ROLE_KEY, projectRef)
  const secret = validatePrivateKey(process.env.SUPABASE_SECRET_KEY, projectRef)
  const selected = service.ok
    ? { name: 'SUPABASE_SERVICE_ROLE_KEY', status: service }
    : secret.ok
      ? { name: 'SUPABASE_SECRET_KEY', status: secret }
      : null

  return { service, secret, selected }
}

function validateHex64(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, status: 'missing' }
  }
  return /^[0-9a-fA-F]{64}$/.test(value)
    ? { ok: true, status: 'hex64 valid' }
    : { ok: false, status: 'invalid' }
}

function validateAuthSessionSecret(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, status: 'missing' }
  }
  if (value.length < 32) return { ok: false, status: 'too-short' }
  if (/placeholder|change[-_]?me|example/i.test(value)) {
    return { ok: false, status: 'placeholder' }
  }
  return { ok: true, status: 'present' }
}

function printStatus(name, status, optional, ignored) {
  const level = status.ok ? 'OK' : optional && ignored ? 'WARN' : 'FAIL'
  console.log(`[${level}] ${name}: ${status.status}`)
}

function printResult(ok) {
  console.log(`RESULT: ${ok ? 'ok' : 'failed'}`)
  process.exitCode = ok ? 0 : 1
}

module.exports = {
  requireNode24,
  parseArgs,
  loadEnvFile,
  decodeJwtPayload,
  parseSupabaseUrl,
  projectRefFromUrl,
  validateSupabaseUrl,
  validatePublicKey,
  validatePrivateKey,
  inspectPrivateKeys,
  validateHex64,
  validateAuthSessionSecret,
  printStatus,
  printResult,
}
