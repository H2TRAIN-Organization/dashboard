'use strict'

const {
  requireNode24,
  parseArgs,
  loadEnvFile,
  projectRefFromUrl,
  validateSupabaseUrl,
  validatePublicKey,
  validatePrivateKey,
  validateHex64,
  validateAuthSessionSecret,
  printStatus,
  printResult,
} = require('./lib/diagnostics')

function usage() {
  console.log('Uso: node scripts/check_env.js [--env .env.local]')
  console.log('Comprueba configuración sin imprimir valores, claves ni PII.')
}

function main() {
  requireNode24()
  const args = parseArgs(process.argv.slice(2))

  if (args.unknown.length > 0) {
    console.error('CHECK_ENV: opción no válida')
    usage()
    process.exitCode = 1
    return
  }
  if (args.help) {
    usage()
    return
  }

  const env = loadEnvFile(args.envFile)
  console.log('CHECK_ENV: diagnóstico de configuración (sin valores)')
  console.log(`ENV_FILE: ${env.reason}`)

  const url = process.env.SUPABASE_URL
  const projectRef = projectRefFromUrl(url)
  const urlStatus = validateSupabaseUrl(url)
  const publicStatus = validatePublicKey(process.env.SUPABASE_PUBLISHABLE_KEY, projectRef)
  const serviceStatus = validatePrivateKey(process.env.SUPABASE_SERVICE_ROLE_KEY, projectRef)
  const secretStatus = validatePrivateKey(process.env.SUPABASE_SECRET_KEY, projectRef)
  const encryptionStatus = validateHex64(process.env.ENCRYPTION_SECRET_KEY)
  const authStatus = validateAuthSessionSecret(process.env.AUTH_SESSION_SECRET)

  const privateOk = serviceStatus.ok || secretStatus.ok

  printStatus('SUPABASE_URL', urlStatus, false, false)
  printStatus('SUPABASE_PUBLISHABLE_KEY', publicStatus, false, false)
  printStatus('SUPABASE_SERVICE_ROLE_KEY', serviceStatus, !serviceStatus.ok && secretStatus.ok, false)
  printStatus(
    'SUPABASE_SECRET_KEY',
    secretStatus,
    true,
    serviceStatus.ok && !secretStatus.ok,
  )
  printStatus('ENCRYPTION_SECRET_KEY', encryptionStatus, false, false)

  if (process.env.ENCRYPTION_SECRET_KEY0 !== undefined) {
    printStatus('ENCRYPTION_SECRET_KEY0', validateHex64(process.env.ENCRYPTION_SECRET_KEY0), true, true)
  }

  printStatus('AUTH_SESSION_SECRET', authStatus, false, false)

  printResult(
    urlStatus.ok &&
      publicStatus.ok &&
      privateOk &&
      encryptionStatus.ok &&
      authStatus.ok,
  )
}

try {
  main()
} catch {
  console.error('CHECK_ENV: error inesperado durante el diagnóstico')
  process.exitCode = 1
}
