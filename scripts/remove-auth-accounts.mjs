/**
 * MT56 · Borrado controlado de cuentas de prueba/residuales.
 *
 * Elimina una cuenta en las dos capas, en este orden:
 *  1. fila de aplicación public.users vía t009_delete_user — falla cerrado si
 *     la cuenta tiene datos de salud asociados (USER_HAS_DATA);
 *  2. identidad GoTrue en auth.users vía Admin API (searched por el vínculo
 *     app_metadata.app_user_id; sin vínculo, por email derivado del username).
 *
 * Sin datos no se borra nada por accidente: sin --apply es dry-run y la
 * eliminación falla cerrado ante cualquier error del RPC.
 *
 * Uso:
 *   node --env-file=.env.local scripts/remove-auth-accounts.mjs <UserID...> [--apply]
 */

import { deriveEmail, normalizeIdentity } from './seed-auth-users.mjs'

/** Par (UserID, identidad GoTrue) para cada cuenta que se va a eliminar. */
export function buildRemovalPlan({ appUsers, authUsers, targetUserIds }) {
  const targets = []
  const errors = []
  for (const rawId of targetUserIds ?? []) {
    const userId = String(Number(rawId))
    const appUser = (appUsers ?? []).find((user) => String(user.UserID) === userId)
    if (appUser === undefined) {
      errors.push({ userId, reason: 'UNKNOWN_APP_USER' })
      continue
    }
    const username = String(appUser.Username ?? '')
    const email = normalizeIdentity(username).includes('@')
      ? normalizeIdentity(username)
      : deriveEmail({ username }).email

    let authUserId = null
    for (const user of authUsers ?? []) {
      const linked = String(user?.app_metadata?.app_user_id ?? '')
      const sameEmail =
        typeof user?.email === 'string' && normalizeIdentity(user.email) === email
      if (linked === userId || sameEmail) {
        authUserId = user.id
        break
      }
    }
    if (authUserId === null) {
      errors.push({ userId, reason: 'NO_AUTH_IDENTITY' })
      continue
    }
    targets.push({ userId, username, email, authUserId })
  }
  return { targets, errors }
}

/**
 * Aplica el plan. El RPC falla cerrado si la cuenta tiene datos: en ese caso
 * no se toca la identidad GoTrue y se reporta el motivo.
 */
export async function applyRemovalPlan(plan, gateway) {
  const report = []
  for (const target of plan.targets) {
    const deleted = await gateway.deleteAppUser(target.userId)
    if (deleted !== true) {
      report.push({
        userId: target.userId,
        action: 'skipped',
        reason: deleted === false ? 'USER_HAS_DATA' : 'RPC_ERROR',
      })
      continue
    }
    const identity = await gateway.deleteAuthIdentity(target.authUserId)
    report.push({
      userId: target.userId,
      action: identity.error ? 'identity-delete-failed' : 'removed',
      email: target.email,
      reason: identity.error?.message,
    })
  }
  for (const error of plan.errors) {
    report.push({ userId: error.userId, action: 'error', reason: error.reason })
  }
  const counts = report.reduce(
    (acc, item) => ({ ...acc, [item.action]: (acc[item.action] ?? 0) + 1 }),
    {},
  )
  return { report, counts }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const targetUserIds = args.filter((arg) => arg !== '--apply')

  if (targetUserIds.length === 0) {
    console.error('Uso: scripts/remove-auth-accounts.mjs <UserID...> [--apply]')
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

  const plan = buildRemovalPlan({ appUsers: appRows, authUsers, targetUserIds })
  console.log(`Plan: ${JSON.stringify(plan)}`)

  if (!apply) {
    console.log('DRY-RUN: añade --apply para eliminar.')
    return
  }

  const gateway = {
    deleteAppUser: async (userId) => {
      const { data, error } = await client.rpc('t009_delete_user', {
        p_user_id: Number(userId),
      })
      if (error) {
        console.error(`t009_delete_user(${userId}):`, error.message)
        return null
      }
      return data === true
    },
    deleteAuthIdentity: async (authUserId) => {
      const { error } = await client.auth.admin.deleteUser(authUserId)
      return { error }
    },
  }
  const outcome = await applyRemovalPlan(plan, gateway)
  console.log(`Resultado: ${JSON.stringify(outcome)}`)
}

const invokedDirectly = process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, '/').endsWith('scripts/remove-auth-accounts.mjs')
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
