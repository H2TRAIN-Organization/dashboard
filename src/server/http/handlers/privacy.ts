import { z } from 'zod'
import type { AuthUseCases } from '@/server/application/auth/auth-use-cases'
import { ServiceUnavailableError, UnauthorizedError, ConflictError } from '@/server/domain/errors'
import { initialPrivacyStatus, PRIVACY_POLICY_VERSION } from '@/server/domain/privacy'
import { buildClearedSessionCookie } from '../cookies'
import { jsonResult, parseInput } from '../problem'

const decisionSchema = z.object({
  policyVersion: z.string().min(1).max(100), surface: z.enum(['login', 'banner']),
  decision: z.enum(['accept', 'reject']), language: z.enum(['es', 'en']),
  requestId: z.uuid(),
}).strict()

export async function privacyStatus(auth: AuthUseCases, token: string | undefined) {
  if (!token) throw new UnauthorizedError()
  const session = await auth.getSession(token)
  return jsonResult(200, session.privacy ?? initialPrivacyStatus())
}
export async function privacyDecision(auth: AuthUseCases, token: string | undefined, body: unknown, secure: boolean) {
  if (!token) throw new UnauthorizedError()
  const decision = parseInput(decisionSchema, body)
  if (decision.policyVersion !== PRIVACY_POLICY_VERSION) throw new ConflictError('CONFLICT', 'Versión del aviso obsoleta')
  if (!auth.decidePrivacy) throw new ServiceUnavailableError()
  const result = await auth.decidePrivacy(token, decision)
  return jsonResult(200, result, undefined, result.rejected ? [buildClearedSessionCookie(secure)] : undefined)
}
