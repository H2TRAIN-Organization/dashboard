/**
 * Sonda de solo lectura para MT45: comprueba el estado real de
 * `public.users` y `auth.users` antes de sembrar identidades.
 * No escribe nada. Uso: node --env-file=.env.local scripts/probe-auth-users.mjs
 */

import pg from 'pg'

const { Client: PostgresClient } = pg

function readPostgresUrl() {
  const value = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL
  if (!value) throw new Error('Falta POSTGRES_URL_NON_POOLING o POSTGRES_URL en el entorno.')
  return value
}

async function main() {
  const client = new PostgresClient({ connectionString: readPostgresUrl(), ssl: { rejectUnauthorized: false } })
  await client.connect()

  const { rows: appRows } = await client.query(
    'select "UserID", "Username", "UUID", role, "PasswordHash" from public.users order by "UserID"',
  )
  const { rows: authRows } = await client.query(
    'select id, email, email_confirmed_at is not null as confirmed, raw_app_meta_data from auth.users order by created_at',
  )

  const normalized = appRows.map((row) => String(row.Username ?? '').trim().normalize('NFC').toLowerCase())
  const duplicates = normalized.filter((value, index) => normalized.indexOf(value) !== index)
  const bcrypt = appRows.filter((row) => /^\$2[aby]\$\d{2}\$/.test(String(row.PasswordHash ?? ''))).length
  const authEmails = new Set(authRows.map((row) => String(row.email ?? '').trim().toLowerCase()))
  const usernameMatchesAuthEmail = appRows.filter(
    (row) => authEmails.has(String(row.Username ?? '').trim().toLowerCase()),
  ).length

  console.log(JSON.stringify({
    publicUsers: appRows.length,
    uniqueUsernames: new Set(normalized).size === appRows.length,
    duplicateUsernames: duplicates,
    bcryptHashes: bcrypt,
    nonBcryptHashes: appRows.length - bcrypt,
    authUsers: authRows.length,
    authConfirmed: authRows.filter((row) => row.confirmed).length,
    authWithAppUserId: authRows.filter((row) => row.raw_app_meta_data?.app_user_id !== undefined).length,
    usernameMatchesAuthEmail: usernameMatchesAuthEmail,
    usernames: appRows.map((row) => ({ id: row.UserID, username: String(row.Username ?? '').slice(0, 3) + '***', role: row.role })),
  }, null, 2))

  await client.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
