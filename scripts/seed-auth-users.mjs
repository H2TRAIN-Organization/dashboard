/**
 * MT45 · Auth Fase 0: siembra de identidades en Supabase Auth (GoTrue).
 *
 * Migra las cuentas de `public.users` a `auth.users` conservando las
 * contraseñas: los hashes bcrypt se importan tal cual (Supabase Auth los
 * acepta) y los hashes no soportados dejan la cuenta sin contraseña para
 * forzar un reset controlado. El vínculo con la aplicación se guarda en
 * `app_metadata` como `{ app_user_id, role }`.
 *
 * El script es idempotente: cada ejecución reconcilia contra `auth.users`
 * (por `app_user_id` o por email ya confirmado) y solo crea lo que falta.
 *
 * Uso:
 *   node --env-file=.env.local scripts/seed-auth-users.mjs            # dry-run
 *   node --env-file=.env.local scripts/seed-auth-users.mjs --apply    # aplica
 *
 * Las funciones de planificación son puras y están exportadas para las
 * pruebas de `scripts/test_seed_auth_users.test.mjs`; la E/S se inyecta.
 */

/** Dominio reservado (.invalid, no enrutable) para cuentas sin email real. */
export const SYNTHETIC_EMAIL_DOMAIN = 'users.h2train.invalid'

/** Normalización canónica de identidad: trim, NFC y minúsculas. */
export function normalizeIdentity(value) {
  return String(value ?? '').trim().normalize('NFC').toLowerCase()
}

/**
 * Clasifica el hash almacenado en `public.users.PasswordHash`.
 * - `bcrypt`: importable por Supabase Auth ($2a$/$2b$/$2y$, coste 10-14).
 * - `unsupported`: longitud de digest SHA-256 u otro formato no reconocido.
 * - `missing`: sin hash; la cuenta nace sin contraseña (reset obligatorio).
 */
export function classifyPasswordHash(hash) {
  const value = String(hash ?? '')
  if (/^\$2[aby]\$(\d{2})\$/.test(value)) {
    const cost = Number(value.split('$')[2])
    if (cost >= 10 && cost <= 14) return { kind: 'bcrypt', importable: true }
    return { kind: 'bcrypt', importable: false, reason: `bcrypt cost ${cost} fuera de rango` }
  }
  if (value.length === 0) return { kind: 'missing', importable: false, reason: 'sin hash' }
  return { kind: 'unsupported', importable: false, reason: `formato no-bcrypt (${value.length} chars)` }
}

/** Convierte un username en la parte local de un email sintético seguro. */
export function syntheticLocalPart(username) {
  const slug = String(username ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._%+-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return slug.length > 0 ? slug : 'user'
}

/**
 * Deduce el email de una cuenta de aplicación.
 * Las cuentas de email tienen su dirección en `Username` (contrato del
 * gateway: coincidencia única por email confirmado); el resto recibe un
 * email sintético no enrutable bajo `.invalid`.
 */
export function deriveEmail({ username }) {
  const value = String(username ?? '')
  const normalized = normalizeIdentity(value)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { email: normalized, synthetic: false }
  }
  return {
    email: `${syntheticLocalPart(value)}@${SYNTHETIC_EMAIL_DOMAIN}`,
    synthetic: true,
  }
}

/** Índices de `auth.users` por `app_metadata.app_user_id` y por email. */
export function indexAuthUsers(authUsers) {
  const byAppUserId = new Map()
  const byEmail = new Map()
  for (const user of authUsers ?? []) {
    const appUserId = user?.app_metadata?.app_user_id
    if (appUserId !== undefined && appUserId !== null) {
      byAppUserId.set(String(appUserId), user)
    }
    const email = user?.email
    if (typeof email === 'string' && email.length > 0) {
      byEmail.set(normalizeIdentity(email), user)
    }
  }
  return { byAppUserId, byEmail }
}

/**
 * Plan de siembra puro: decide por cada cuenta de `public.users` si hay que
 * crearla, si ya existe vinculada o si es un conflicto. Nunca muta entradas.
 */
export function buildSeedPlan({ appUsers, authUsers = [] }) {
  const { byAppUserId, byEmail } = indexAuthUsers(authUsers)
  const entries = []
  const seenEmails = new Set()
  const seenUserIds = new Set()

  for (const appUser of appUsers ?? []) {
    const userId = String(appUser.UserID)
    const username = String(appUser.Username ?? '')
    const role = String(appUser.role ?? '')
    const hash = classifyPasswordHash(appUser.PasswordHash)
    const duplicateUserId = seenUserIds.has(userId)

    const base = { userId, username, role, hash, hashSource: String(appUser.PasswordHash ?? ''), duplicateUserId }
    seenUserIds.add(userId)

    if (duplicateUserId) {
      entries.push({ ...base, action: 'error', reason: 'UserID duplicado en public.users' })
      continue
    }

    const linked =
      byAppUserId.get(userId) ??
      (/@/.test(username) ? byEmail.get(normalizeIdentity(username)) : undefined)

    if (linked !== undefined) {
      entries.push({ ...base, action: 'already-linked', authUserId: linked.id })
      continue
    }

    const { email, synthetic } = deriveEmail({ username })
    // Reconciliación idempotente: si una ejecución anterior ya creó la cuenta
    // con ese email (con o sin app_user_id), no se vuelve a crear.
    const existingWithEmail = byEmail.get(email)
    if (existingWithEmail !== undefined || seenEmails.has(email)) {
      entries.push({
        ...base,
        action: 'already-linked',
        email,
        authUserId: existingWithEmail?.id ?? null,
      })
      continue
    }
    seenEmails.add(email)

    entries.push({
      ...base,
      action: 'create',
      email,
      synthetic,
      importable: hash.importable,
      resetRequired: !hash.importable,
    })
  }

  const summary = {
    total: entries.length,
    create: entries.filter((entry) => entry.action === 'create').length,
    importable: entries.filter((entry) => entry.action === 'create' && entry.importable).length,
    resetRequired: entries.filter((entry) => entry.action === 'create' && entry.resetRequired).length,
    alreadyLinked: entries.filter((entry) => entry.action === 'already-linked').length,
    errors: entries.filter((entry) => entry.action === 'error').length,
  }
  return { entries, summary }
}

/**
 * Aplica el plan con un cliente admin inyectado
 * (`{ listUsers, createUser }`). Solo crea cuentas con acción `create`;
 * el resto se reporta sin tocar nada. Devuelve un informe por entrada.
 */
export async function applySeedPlan(plan, admin) {
  const report = []
  const created = new Map()

  for (const entry of plan.entries) {
    if (entry.action === 'already-linked') {
      report.push({ userId: entry.userId, action: 'already-linked' })
      continue
    }
    if (entry.action === 'error') {
      report.push({ userId: entry.userId, action: 'error', reason: entry.reason })
      continue
    }

    const attributes = {
      email: entry.email,
      email_confirm: true,
      app_metadata: {
        app_user_id: Number(entry.userId),
        role: entry.role,
      },
    }
    if (entry.importable) attributes.password_hash = entry.hashSource

    const result = await admin.createUser(attributes)
    if (result.error) {
      report.push({
        userId: entry.userId,
        action: 'failed',
        email: entry.email,
        reason: result.error.message ?? String(result.error),
      })
      continue
    }
    created.set(entry.userId, result.data?.user?.id ?? null)
    report.push({
      userId: entry.userId,
      action: 'created',
      email: entry.email,
      synthetic: entry.synthetic,
      resetRequired: entry.resetRequired,
    })
  }

  const counts = report.reduce(
    (acc, item) => ({ ...acc, [item.action]: (acc[item.action] ?? 0) + 1 }),
    {},
  )
  return { report, counts, createdAuthUserIds: created }
}

/** Validación ligera: la clave debe ser un JWT con role=service_role. */
export function assertServiceRoleKey(key) {
  const parts = String(key ?? '').split('.')
  if (parts.length !== 3) throw new Error('La clave de servicio no es un JWT válido.')
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (payload.role !== 'service_role') throw new Error('La clave no es service_role.')
  } catch (error) {
    if (error instanceof Error && error.message.includes('service_role')) throw error
    throw new Error('La clave de servicio no se pudo validar.')
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.')
    process.exit(1)
  }
  assertServiceRoleKey(SUPABASE_SERVICE_ROLE_KEY)

  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    db: { schema: 'public' },
  })

  const { data: appRows, error: appError } = await client
    .from('users')
    .select('UserID,Username,UUID,role,PasswordHash')
  if (appError) {
    console.error('No se pudo leer public.users:', appError.message)
    process.exit(1)
  }

  const authUsers = []
  let page = 1
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.error('No se pudo listar auth.users:', error.message)
      process.exit(1)
    }
    authUsers.push(...(data.users ?? []))
    if (data.users.length < 200) break
    page += 1
  }

  const plan = buildSeedPlan({ appUsers: appRows, authUsers })
  console.log(`Revisión del plan: ${JSON.stringify(plan.summary)}`)

  if (!apply) {
    console.log('DRY-RUN. Detalle por cuenta:')
    for (const entry of plan.entries) {
      console.log(JSON.stringify({
        userId: entry.userId,
        username: entry.username,
        action: entry.action,
        email: entry.email ?? null,
        hash: entry.hash?.kind ?? entry.hash,
        resetRequired: entry.resetRequired ?? false,
        reason: entry.reason ?? null,
      }))
    }
    return
  }

  const admin = {
    listUsers: (args) => client.auth.admin.listUsers(args),
    createUser: (attributes) => client.auth.admin.createUser(attributes),
  }
  const outcome = await applySeedPlan(plan, admin)
  console.log(`Aplicado: ${JSON.stringify(outcome.counts)}`)
  for (const item of outcome.report) {
    console.log(JSON.stringify(item))
  }
  const resetRequired = outcome.report.filter((item) => item.resetRequired)
  if (resetRequired.length > 0) {
    console.log(`Reset de contraseña obligatorio para: ${resetRequired.map((r) => r.userId).join(', ')}`)
  }
}

const invokedDirectly = process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, '/').endsWith('scripts/seed-auth-users.mjs')
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
