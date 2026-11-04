import { AppError } from './errors'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/lib/privacy-policy'

export { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION }
export interface PrivacyStatus {
  readonly policyVersion: string
  readonly policyHash: string
  readonly state: 'initial' | 'banner' | 'complete'
}
export interface PrivacyDecision {
  readonly policyVersion: string
  readonly surface: 'login' | 'banner'
  readonly decision: 'accept' | 'reject'
  readonly language: 'es' | 'en'
  readonly requestId: string
}
export interface PrivacyDecisionResult extends PrivacyStatus { readonly rejected: boolean }
export function initialPrivacyStatus(): PrivacyStatus {
  return { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'initial' }
}
export function assertPrivacyAcknowledged(session: { readonly privacy?: PrivacyStatus }): void {
  if (session.privacy?.policyVersion !== PRIVACY_POLICY_VERSION ||
      session.privacy.policyHash !== PRIVACY_POLICY_HASH ||
      !['banner', 'complete'].includes(session.privacy.state)) {
    throw new AppError(403, 'PRIVACY_ACTION_REQUIRED', 'Debe leer el aviso de privacidad antes de acceder a los datos')
  }
}
