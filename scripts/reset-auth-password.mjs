/**
 * MT56 · Reset controlado de contraseña en GoTrue para una cuenta concreta.
 *
 * Está pensado para:
 *  - las 5 cuentas cuya hash en public.users no es importable (UserID 7, 19,
 *    20, 23, 57): nacieron sin contraseña en auth.users,
 *  - cualquier cuenta cuyo hash de GoTrue diverja del que el usuario conoce
 *    (decisión del admin: nueva contraseña acordada con el usuario).
 *
 * Reglas del mismo estilo que los arreglos manuales: la contraseña nueva la
 * decide el admin y se acuerda con el usuario; el script jamás la imprime ni
 * la registra; siempre repara el vínculo app_metadata en la misma llamada
 * (el login por username lo necesita).
 *
 * Uso:
 *   node --env-file=.env.local scripts/reset-auth-password.mjs <UserID> --password <nueva> [--apply]
 * Sin --apply es dry-run (muestra a quién afectaría, no escribe).
 */

import { deriveEmail, normalizeIdentity } from './seed-auth-users.mjs'

const MIN_PASSWORD_LENGTH = 8

/** Localiza la identidad GoTrue vinculada explícitamente a un UserID. */
export function findAuthUserByAppUserId(authUsers, userId) {
  const target = String(Number(userId))
  for (const user of authUsers ?? []) {
    if (String(user?.app_metadata?.app_user_id ?? '') === target) {
      return user
    }
  }
  return null
}

function authMetadata(user) {
  return user?.app_metadata !== null && typeof user?.app_metadata === 'object'
    ? user.app_metadata
    : {}
}

/**
 * Plan puro de reset. Nunca sobrescribe a ciegas: exige que la cuenta exista
 * en public.users y que exista (o se pueda deducir) su identidad en GoTrue.
 */
export function buildResetPlan({
  appUsers,
  authUsers,
  targetUserId,
  newPassword,
}) {
  const userId = String(Number(targetUserId))
  const appUser = (appUsers ?? []).find(
    (user) => String(user.UserID) === userId,
  )
  if (appUser === undefined) {
    return { action: 'error', reason: 'UNKNOWN_APP_USER', targetUserId: userId }
  }
  if (
    typeof newPassword !== 'string' ||
    newPassword.length < MIN_PASSWORD_LENGTH
  ) {
    return {
      action: 'error',
      reason: `WEAK_PASSWORD (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`,
      targetUserId: userId,
    }
  }

  const username = String(appUser.Username ?? '')
  const email = normalizeIdentity(username).includes('@')
    ? normalizeIdentity(username)
    : deriveEmail({ username }).email

  const authUser =
    findAuthUserByAppUserId(authUsers, userId) ??
    (authUsers ?? []).find(
      (user) =>
        typeof user?.email === 'string' &&
        normalizeIdentity(user.email) === email,
    ) ??
    null

  if (authUser === null) {
    return {
      action: 'error',
      reason: 'NO_AUTH_IDENTITY (aplica primero scripts/seed-auth-users.mjs)',
      targetUserId: userId,
      email,
    }
  }

  const metadata = authMetadata(authUser)
  const needsLink =
    String(metadata.app_user_id ?? '') !== userId ||
    metadata.role !== String(appUser.role ?? '')

  return {
    action: 'reset',
    targetUserId: userId,
    authUserId: authUser.id,
    email,
    role: String(appUser.role ?? ''),
    needsLink,
    // La contraseña viaja en el plan para aplicar; el CLI la elimina del log.
    newPassword,
  }
}

/**
 * Aplica el plan con un cliente admin inyectado. Una única llamada fija la
 * contraseña nueva y repara el vínculo app_metadata. El informe nunca
 * contiene la contraseña.
 */
export async function applyResetPlan(plan, admin) {
  if (plan.action === 'error') {
    return { report: { action: 'error', reason: plan.reason }, counts: { error: 1 } }
  }

  const attributes = { password: plan.newPassword }
  if (plan.needsLink) {
    attributes.app_metadata = {
      app_user_id: Number(plan.targetUserId),
      role: plan.role,
    }
  }

  const result = await admin.updateUserById(plan.authUserId, attributes)
  if (result && result.error) {
    return {
      report: {
        action: 'failed',
        email: plan.email,
        reason: result.error.message ?? String(result.error),
      },
      counts: { failed: 1 },
    }
  }
  return {
    report: {
      action: 'reset',
      userId: plan.targetUserId,
      email: plan.email,
      role: plan.role,
      linkFixed: plan.needsLink,
    },
    counts: { reset: 1 },
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const passwordIndex = args.indexOf('--password')
  const newPassword =
    passwordIndex >= 0 && passwordIndex + 1 < args.length
      ? args[passwordIndex + 1]
      : undefined
  const targetUserId = args.find(
    (arg) => arg !== '--apply' && arg !== '--password' && arg !== newPassword,
  )

  if (!targetUserId || newPassword === undefined) {
    console.error(
      'Uso: scripts/reset-auth-password.mjs <UserID> --password <nueva> [--apply]',
    )
    process.exit(1)
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.')
    process.exit(1)
  }

  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    db: { schema: 'public' },
  })

  const { data: appRows, error: appError } = await client
    .from('users')
    .select('UserID,Username,role')
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

  const plan = buildResetPlan({
    appUsers: appRows,
    authUsers,
    targetUserId,
    newPassword,
  })
  console.log(`Plan: ${JSON.stringify({ ...plan, newPassword: undefined })}`)

  if (!apply || plan.action === 'error') {
    if (!apply) console.log('DRY-RUN: añade --apply para aplicar.')
    return
  }

  const admin = {
    updateUserById: (userId, attributes) =>
      client.auth.admin.updateUserById(userId, attributes),
  }
  const outcome = await applyResetPlan(plan, admin)
  console.log(`Resultado: ${JSON.stringify(outcome)}`)
}

const invokedDirectly = process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, '/').endsWith('scripts/reset-auth-password.mjs')
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
