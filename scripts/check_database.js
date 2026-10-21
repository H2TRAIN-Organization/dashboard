'use strict'

const {
  requireNode24,
  parseArgs,
  loadEnvFile,
  projectRefFromUrl,
  validateSupabaseUrl,
  inspectPrivateKeys,
  printResult,
} = require('./lib/diagnostics')

// Verified legacy names: users plus the six health collections. No *_data
// aliases are assumed or probed. polar_data is included explicitly.
const TABLES = Object.freeze([
  'users',
  'insulindata',
  'fooddata',
  'exercisedata',
  'periodrecords',
  'mooddata',
  'polar_data',
])

function usage() {
  console.log(
    'Uso: node scripts/check_database.js --live [--env .env.local]',
  )
  console.log(
    'Diagnóstico read-only: HEAD/count sobre public con clave privada; no usa RPC, login ni escrituras.',
  )
}

async function main() {
  requireNode24()
  const args = parseArgs(process.argv.slice(2))

  if (args.unknown.length > 0) {
    console.error('CHECK_DB: opción no válida')
    usage()
    process.exitCode = 1
    return
  }
  if (args.help) {
    usage()
    return
  }
  if (!args.live) {
    console.error('CHECK_DB: se requiere --live para consultar la base de datos')
    usage()
    process.exitCode = 2
    return
  }

  const env = loadEnvFile(args.envFile)
  console.log('CHECK_DB: diagnóstico read-only (sin valores)')
  console.log(`ENV_FILE: ${env.reason}`)

  const urlStatus = validateSupabaseUrl(process.env.SUPABASE_URL)
  const projectRef = projectRefFromUrl(process.env.SUPABASE_URL)
  const privateKeys = inspectPrivateKeys(projectRef)

  console.log(`[${urlStatus.ok ? 'OK' : 'FAIL'}] SUPABASE_URL: ${urlStatus.status}`)

  if (!urlStatus.ok) {
    printResult(false)
    return
  }

  if (privateKeys.selected === null) {
    console.log('[FAIL] PRIVATE_KEY: no valid service_role/sb_secret')
    printResult(false)
    return
  }

  console.log(
    `[OK] PRIVATE_KEY: ${privateKeys.selected.name} ${privateKeys.selected.status.status}`,
  )

  const privateKey = process.env[privateKeys.selected.name]
  const { createClient } = require('@supabase/supabase-js')
  const supabase = createClient(
    process.env.SUPABASE_URL,
    privateKey,
    {
      db: { schema: 'public' },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  let accessible = 0
  for (const table of TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })

    if (error) {
      const code = typeof error.code === 'string' && error.code.length > 0 ? ` (${error.code})` : ''
      console.log(`[WARN] ${table}: inaccessible${code}`)
      continue
    }

    if (typeof count !== 'number') {
      console.log(`[WARN] ${table}: count-unavailable`)
      continue
    }

    accessible += 1
    console.log(`[OK] ${table}: count=${count}`)
  }

  console.log(`TABLES: ${accessible}/${TABLES.length} consultables`)
  printResult(accessible === TABLES.length)
}

main().catch(() => {
  console.error('CHECK_DB: error inesperado durante el diagnóstico')
  process.exitCode = 1
})
