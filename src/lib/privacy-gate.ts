/**
 * Textos y utilidades del gate de privacidad que NO forman parte del aviso
 * legal auditado (src/lib/privacy-policy.ts): cambiarlos no invalida el hash
 * de la política ni obliga a los usuarios a releer el aviso.
 */
export const privacyGateText = {
  es: {
    decisionConflict: 'La decisión no se pudo registrar por un conflicto del servidor. Se ha actualizado tu estado; vuelve a intentarlo.',
    escape: 'Cerrar sesión y volver al inicio de sesión',
  },
  en: {
    decisionConflict: 'The decision could not be recorded due to a server conflict. Your state has been refreshed; please try again.',
    escape: 'Sign out and return to the login',
  },
} as const

/**
 * Textos del rechazo desde la vista Política de Privacidad (MT37). Como el
 * resto de textos del gate, no forman parte del aviso legal auditado: pueden
 * ajustarse sin invalidar el hash de la política.
 */
export const privacyRejectionText = {
  es: {
    rejectButton: 'Rechazar la política de privacidad',
    modalTitle: '¿Confirma el rechazo?',
    modalBody:
      'Si rechaza la política de privacidad, su sesión actual se cerrará y será redirigido a la pantalla de inicio de sesión. Esta acción no retira el consentimiento externo ni suprime sus datos.',
    confirm: 'Sí, rechazar y cerrar sesión',
    cancel: 'Cancelar',
  },
  en: {
    rejectButton: 'Reject the privacy policy',
    modalTitle: 'Do you confirm the rejection?',
    modalBody:
      'If you reject the privacy policy, your current session will be closed and you will be redirected to the sign-in screen. This action does not withdraw external consent or delete your data.',
    confirm: 'Yes, reject and sign out',
    cancel: 'Cancel',
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
