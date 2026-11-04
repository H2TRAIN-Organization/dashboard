import type { LoginInput } from '@/lib/api-types'

export type LoginIdentifierKind = 'email' | 'username'

export interface LoginIdentifierAttempt {
  kind: LoginIdentifierKind
  value: string
}

/**
 * Identidad de entrada del login unificado.
 *
 * El backend centraliza la resolución de identidades y el fallback de los
 * nombres de participante antiguos con forma de correo. La UI solo elige el
 * método inicial: `email` cuando el valor contiene `@` y `username` en el
 * resto. Nunca reintenta otro método tras un 401, porque una denegación por
 * ambigüedad debe llegar intacta al usuario.
 */
export function buildLoginIdentityAttempts(identifier: string): LoginIdentifierAttempt[] {
  const value = identifier.trim()
  if (value.length === 0) return []

  return [
    {
      kind: value.includes('@') ? 'email' : 'username',
      value,
    },
  ]
}

export function toLoginInput(
  attempt: LoginIdentifierAttempt,
  password: string,
): LoginInput {
  return attempt.kind === 'email'
    ? { email: attempt.value, password }
    : { username: attempt.value, password }
}
