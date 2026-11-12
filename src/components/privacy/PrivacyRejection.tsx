'use client'

/**
 * Rejection flow from the standalone Privacy Policy view (MT37).
 *
 * The PrivacyBoundary gate already handles the first-access rejection; this
 * component adds the same decision to /privacy with a red button and a formal
 * confirmation modal. Confirming records the rejection (which revokes the
 * session server-side), clears the local session and redirects to /login.
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { useSession } from '@/contexts/SessionContext'
import { PRIVACY_POLICY_VERSION } from '@/lib/privacy-policy'
import {
  classifyPrivacyDecisionFailure,
  privacyGateText,
  privacyRejectionText,
} from '@/lib/privacy-gate'

export default function PrivacyRejection() {
  const { language } = useLanguage()
  const { session, logout } = useSession()
  const router = useRouter()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<'transient' | 'conflict' | null>(null)
  // Misma idempotencia que el gate: un reintento del mismo rechazo en el mismo
  // idioma reutiliza la requestId ya generada.
  const requestRef = useRef<{ key: string; id: string } | null>(null)

  if (!session) return null

  const text = privacyRejectionText[language]
  const policyText = privacyPolicyText(language)

  function openModal() {
    setFailure(null)
    setConfirmOpen(true)
  }

  async function confirmRejection() {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const key = `reject:${language}`
    if (requestRef.current?.key !== key) {
      requestRef.current = { key, id: crypto.randomUUID() }
    }
    try {
      const response = await fetch('/api/privacy/decision', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyVersion: PRIVACY_POLICY_VERSION,
          surface: 'login',
          decision: 'reject',
          language,
          requestId: requestRef.current.id,
        }),
      })
      if (!response.ok) {
        setFailure(classifyPrivacyDecisionFailure(response.status))
        return
      }
      requestRef.current = null
      setConfirmOpen(false)
      // El rechazo atómico ya revocó la sesión y su cookie en el servidor:
      // se limpia el estado local y se vuelve al inicio de sesión.
      window.dispatchEvent(new Event('auth:unauthorized'))
      await logout()
      router.replace('/login')
    } catch {
      setFailure('transient')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-red-600 px-4 py-2 font-semibold text-white shadow-md transition hover:bg-red-700"
      >
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        {text.rejectButton}
      </button>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-rejection-title"
            className="relative w-full max-w-lg rounded-2xl border border-gray-200/50 bg-white/95 p-6 shadow-2xl backdrop-blur-xl sm:rounded-3xl sm:p-8"
          >
            <div className="mb-4 flex items-start gap-4">
              <div className="rounded-2xl bg-gradient-to-br from-red-600 to-red-700 p-3 shadow-lg">
                <AlertTriangle className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <h3
                id="privacy-rejection-title"
                className="pt-1 text-xl font-bold text-gray-900 sm:text-2xl"
              >
                {text.modalTitle}
              </h3>
            </div>
            <p className="text-sm text-gray-700 sm:text-base">{text.modalBody}</p>

            {failure !== null && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                {failure === 'transient' ? policyText.unavailable : privacyGateText[language].decisionConflict}
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void confirmRejection()}
                disabled={busy}
                className="rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white shadow-lg transition hover:bg-red-700 disabled:opacity-50"
              >
                {text.confirm}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                {text.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Los textos del aviso auditado se leen, pero nunca se modifican. */
function privacyPolicyText(language: 'es' | 'en') {
  return language === 'es'
    ? { unavailable: 'No se pudo registrar la decisión. Inténtelo de nuevo más tarde.' }
    : { unavailable: 'The decision could not be recorded. Please try again later.' }
}
