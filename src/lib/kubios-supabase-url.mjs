import { Buffer } from 'node:buffer'

/**
 * K49 - Validación compartida de la configuración del cliente Supabase.
 *
 * Se implementa en `.mjs` para que el CLI (`scripts/kubios-link.mjs`) pueda
 * importarla directamente con Node sin el aviso de tipo de módulo que produce
 * importar un `.ts` en este paquete. El adaptador tipado está en
 * `kubios-supabase-url.ts`.
 *
 * No crea clientes, no hace red y no lee `.env`: solo normaliza y valida los
 * valores antes de que la clave privada pueda enviarse a una URL no confiable.
 *
 * Reglas:
 *   * Solo `https:` o `http:`.
 *   * `http:` únicamente para localhost, 127.0.0.1 o [::1] (pruebas locales).
 *   * Sin usuario/contraseña embebidos en la URL.
 *   * La clave debe ser `service_role`: JWT con ese rol o una clave nueva
 *     `sb_secret_`. No se valida la firma; eso corresponde a Supabase.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function decodeJwtRole(token) {
  const parts = token.split('.')
  if (parts.length !== 3 || !token.startsWith('eyJ')) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'))
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return null
    }
    const role = payload.role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

/** Devuelve la URL normalizada o `null` si no cumple el contrato. */
export function normalizeKubiosSupabaseUrl(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return null
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }

  if (parsed.protocol === 'http:' && !LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    return null
  }

  return trimmed
}

/** Acepta solo una credencial privada con rol `service_role`. */
export function isKubiosServiceRoleKey(value) {
  if (typeof value !== 'string') {
    return false
  }

  const key = value.trim()
  if (key.length < 20) {
    return false
  }
  if (key.startsWith('sb_secret_')) {
    return true
  }

  return decodeJwtRole(key) === 'service_role'
}

/**
 * Valida URL y clave antes de construir cualquier cliente. `ok: false` no
 * incluye el valor recibido, para que los llamadores puedan reportar un error
 * genérico sin filtrar configuración.
 */
export function resolveKubiosSupabaseConfig(urlValue, serviceRoleKeyValue) {
  const url = normalizeKubiosSupabaseUrl(urlValue)
  if (url === null) {
    return { ok: false, reason: 'url' }
  }

  const serviceRoleKey =
    typeof serviceRoleKeyValue === 'string' ? serviceRoleKeyValue.trim() : ''
  if (!isKubiosServiceRoleKey(serviceRoleKey)) {
    return { ok: false, reason: 'service-role-key' }
  }

  return { ok: true, url, serviceRoleKey }
}
