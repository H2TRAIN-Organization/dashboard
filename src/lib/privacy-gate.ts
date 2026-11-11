/**
 * Textos y utilidades del gate de privacidad que NO forman parte del aviso
 * legal auditado (src/lib/privacy-policy.ts): cambiarlos no invalida el hash
 * de la política ni obliga a los usuarios a releer el aviso.
 */
export const privacyGateText = {
  es: {
    decisionConflict: 'La decisión no se pudo registrar por un conflicto del servidor. Se ha actualizado tu estado; vuelve a intentarlo.',
  },
  en: {
    decisionConflict: 'The decision could not be recorded due to a server conflict. Your state has been refreshed; please try again.',
  },
} as const

export type PrivacyDecisionFailureKind = 'transient' | 'conflict'

/**
 * Clasifica el fallo de una decisión de privacidad: los fallos de red y los
 * estados sobrecargados (408/429/5xx) admiten reintentar la misma decisión;
 * el resto de 4xx son conflictos permanentes (p. ej. 409 CONFLICT del RPC)
 * que exigen re-sincronizar el estado del servidor antes de volver a
 * intentar la misma decisión.
 */
export function classifyPrivacyDecisionFailure(status: number): PrivacyDecisionFailureKind {
  if (status === 408 || status === 429 || status >= 500) return 'transient'
  return 'conflict'
}
