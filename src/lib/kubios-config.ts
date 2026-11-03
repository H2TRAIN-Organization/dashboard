import 'server-only'

/**
 * Configuración de Kubios Cloud para uso exclusivo en servidor.
 *
 * Lee las credenciales desde variables de entorno privadas:
 * KUBIOS_USERNAME, KUBIOS_PASSWORD, KUBIOS_CLIENT_ID y, opcionalmente,
 * KUBIOS_TEAM_ID.
 *
 * Este módulo no debe importarse desde componentes cliente y ninguna de sus
 * variables debe publicarse con el prefijo público de Next.js.
 *
 * Nota de seguridad: `import 'server-only'` hace que Next.js rechace la
 * compilación si este módulo se importa desde un componente cliente. Además,
 * `assertServerContext()` mantiene una comprobación en tiempo de ejecución.
 * La contraseña se conserva exactamente como llega, sin recortar espacios.
 *
 * `KUBIOS_TEAM_ID` es opcional: si falta, el llamador resuelve el equipo
 * esperado por nombre desde `GET /v1/user/self`; nunca se elige el primero ni
 * uno arbitrario. Un valor vacío se considera ausente.
 */

export interface KubiosConfig {
  username: string
  password: string
  clientId: string
  teamId?: string
}

/** Origen de variables de entorno; por defecto `process.env`. */
export type KubiosEnvSource = Record<string, string | undefined>

/**
 * Error de configuración incompleta. Solo expone los nombres de las variables
 * que faltan, nunca sus valores.
 */
export class KubiosConfigError extends Error {
  readonly missingVariables: readonly string[]

  constructor(missingVariables: readonly string[]) {
    super(
      missingVariables.length === 1
        ? `Falta la variable de entorno ${missingVariables[0]} para configurar Kubios`
        : `Faltan variables de entorno para configurar Kubios: ${missingVariables.join(', ')}`
    )
    this.name = 'KubiosConfigError'
    this.missingVariables = missingVariables
  }
}

const KUBIOS_ENV_FIELDS: ReadonlyArray<{
  variable: string
  field: keyof KubiosConfig
  /** Si es `true`, el valor se conserva tal cual, sin recortar espacios. */
  exactValue?: boolean
  /** Si es `true`, la variable puede faltar sin invalidar la configuración. */
  optional?: boolean
}> = [
  { variable: 'KUBIOS_USERNAME', field: 'username' },
  // La contraseña puede contener espacios significativos: no se normaliza.
  { variable: 'KUBIOS_PASSWORD', field: 'password', exactValue: true },
  { variable: 'KUBIOS_CLIENT_ID', field: 'clientId' },
  // Opcional: sin ella se descubre el equipo con `/v1/user/self`.
  { variable: 'KUBIOS_TEAM_ID', field: 'teamId', optional: true }
]

/**
 * Impide leer credenciales en el navegador. `server-only` ya bloquea la
 * compilación en cliente; esta comprobación es una defensa adicional en
 * tiempo de ejecución.
 */
function assertServerContext(): void {
  if (typeof window !== 'undefined') {
    throw new Error('La configuración de Kubios solo puede leerse en el servidor')
  }
}

/**
 * Devuelve el valor de la variable o `undefined` si no existe. Un valor vacío
 * se considera ausente. Por defecto se recortan los espacios; los campos
 * marcados como exactos se conservan byte a byte, sin `trim`.
 */
function readRequiredEnv(
  env: KubiosEnvSource,
  variable: string,
  exactValue = false
): string | undefined {
  const raw = env[variable]
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  if (exactValue) return raw

  const value = raw.trim()
  return value.length > 0 ? value : undefined
}

/**
 * Construye la configuración de Kubios a partir del entorno.
 *
 * @throws {KubiosConfigError} si falta alguna de las variables requeridas; el
 * mensaje indica únicamente sus nombres.
 * @throws {Error} si se invoca fuera del servidor.
 */
export function getKubiosConfig(env: KubiosEnvSource = process.env): KubiosConfig {
  assertServerContext()

  const values: Partial<KubiosConfig> = {}
  const missingVariables: string[] = []

  for (const { variable, field, exactValue, optional } of KUBIOS_ENV_FIELDS) {
    const value = readRequiredEnv(env, variable, exactValue)
    if (value === undefined) {
      if (optional !== true) missingVariables.push(variable)
      continue
    }

    values[field] = value
  }

  if (missingVariables.length > 0) {
    throw new KubiosConfigError(missingVariables)
  }

  return values as KubiosConfig
}
