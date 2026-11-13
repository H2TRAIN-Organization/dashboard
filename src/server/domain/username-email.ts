/**
 * Regla de email para identidades GoTrue (MT45/MT49).
 *
 * Las cuentas de email tienen su dirección en `Username` (contrato del
 * gateway de auth: vínculo por coincidencia única de email confirmado). Las
 * cuentas solo-username reciben un email sintético no enrutable bajo el TLD
 * reservado `.invalid`, deducido del username con las mismas reglas que el
 * script de siembra `scripts/seed-auth-users.mjs`. Un admin puede sustituirlo
 * más adelante por el email real del usuario.
 */

export const SYNTHETIC_EMAIL_DOMAIN = 'users.h2train.invalid'

/** Normalización canónica de identidad: trim, NFC y minúsculas. */
export function normalizeIdentityEmail(value: string): string {
  return String(value ?? '').trim().normalize('NFC').toLowerCase()
}

/** Convierte un username en la parte local de un email sintético seguro. */
export function syntheticLocalPart(username: string): string {
  const slug = String(username ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._%+-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return slug.length > 0 ? slug : 'user'
}

/**
 * Deduce el email de una cuenta por su username: email real si el username ya
 * es una dirección de correo; sintético `.invalid` en caso contrario.
 */
export function deriveEmailFromUsername(username: string): string {
  const normalized = normalizeIdentityEmail(username)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return normalized
  }
  return `${syntheticLocalPart(username)}@${SYNTHETIC_EMAIL_DOMAIN}`
}
