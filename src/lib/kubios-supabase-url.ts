import {
  isKubiosServiceRoleKey as isKubiosServiceRoleKeyImpl,
  normalizeKubiosSupabaseUrl as normalizeKubiosSupabaseUrlImpl,
  resolveKubiosSupabaseConfig as resolveKubiosSupabaseConfigImpl
} from './kubios-supabase-url.mjs'

/**
 * K49 - Adaptador tipado de la validación compartida de Supabase.
 *
 * La implementación vive en `kubios-supabase-url.mjs` para que el CLI la
 * importe directamente con Node sin avisos de tipo de módulo. Este archivo es
 * la superficie tipada que usa el código TypeScript del sync.
 */

export interface KubiosSupabaseClientConfig {
  readonly url: string
  readonly serviceRoleKey: string
}

export type KubiosSupabaseConfigFailure = 'url' | 'service-role-key'

export type KubiosSupabaseConfigResult =
  | ({ readonly ok: true } & KubiosSupabaseClientConfig)
  | { readonly ok: false; readonly reason: KubiosSupabaseConfigFailure }

/** Devuelve la URL normalizada o `null` si no cumple el contrato. */
export function normalizeKubiosSupabaseUrl(value: unknown): string | null {
  return normalizeKubiosSupabaseUrlImpl(value)
}

/** Acepta solo una credencial privada con rol `service_role`. */
export function isKubiosServiceRoleKey(value: unknown): boolean {
  return isKubiosServiceRoleKeyImpl(value)
}

/**
 * Valida URL y clave antes de construir cualquier cliente. `ok: false` no
 * incluye el valor recibido, para que los llamadores puedan reportar un error
 * genérico sin filtrar configuración.
 */
export function resolveKubiosSupabaseConfig(
  urlValue: unknown,
  serviceRoleKeyValue: unknown
): KubiosSupabaseConfigResult {
  // La implementacion JS infiere `ok` como boolean; el contrato tipado
  // conserva la union discriminada para que los llamadores puedan estrecharla.
  return resolveKubiosSupabaseConfigImpl(
    urlValue,
    serviceRoleKeyValue
  ) as KubiosSupabaseConfigResult
}
