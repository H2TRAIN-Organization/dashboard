'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { useSession } from '@/contexts/SessionContext'
import { privacyPolicy, PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/lib/privacy-policy'
import { classifyPrivacyDecisionFailure, privacyGateText, type PrivacyDecisionFailureKind } from '@/lib/privacy-gate'
import PrivacyNotice from './PrivacyNotice'

/** Fondo decorativo compartido por las vistas de privacidad, igual al del dashboard. */
function PrivacyBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-400 opacity-10 mix-blend-multiply blur-xl animate-pulse"></div>
      <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-indigo-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-1000"></div>
      <div className="absolute left-1/2 top-40 h-80 w-80 rounded-full bg-purple-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-500"></div>
    </div>
  )
}

/** Tarjeta flotante centrada con el estilo translúcido del dashboard. */
function PrivacyPanel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50 p-4 sm:p-8">
      <PrivacyBackdrop />
      <section className={`relative z-10 my-auto w-full rounded-2xl sm:rounded-3xl border border-gray-200/50 bg-white/90 p-5 shadow-2xl backdrop-blur-xl sm:p-8 ${className}`}>
        {children}
      </section>
    </main>
  )
}

interface DecisionFailure {
  readonly kind: PrivacyDecisionFailureKind
  readonly decision: 'accept' | 'reject'
}

/** Aviso inline cuando una decisión no se registró: el aviso legal sigue visible. */
function DecisionFailureAlert({ failure, language, onRetry }: {
  failure: DecisionFailure
  language: 'es' | 'en'
  onRetry: () => void
}) {
  const text = privacyPolicy[language]
  const message = failure.kind === 'transient' ? text.unavailable : privacyGateText[language].decisionConflict
  return (
    <div role="alert" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">{message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={onRetry}
          className="rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-4 py-2 font-semibold text-white shadow-lg transition hover:from-blue-700 hover:to-indigo-700"
        >
          {text.retry}
        </button>
        <Link href="/privacy" className="rounded-xl border border-blue-200 bg-white px-4 py-2 font-semibold text-blue-700 transition hover:bg-blue-50">
          {text.policy}
        </Link>
      </div>
    </div>
  )
}

export default function PrivacyBoundary({ children }: { children: React.ReactNode }) {
  const { session, loading, error, refresh } = useSession()
  const { language } = useLanguage()
  const path = usePathname()
  const router = useRouter()
  const [forced, setForced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [decisionFailure, setDecisionFailure] = useState<DecisionFailure | null>(null)
  const initialDialogRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<{ key: string; id: string } | null>(null)
  const privacy = session?.privacy
  const stage = privacy?.policyVersion === PRIVACY_POLICY_VERSION && privacy.policyHash === PRIVACY_POLICY_HASH ? privacy.state : 'initial'
  const initial = forced || stage === 'initial'
  const text = privacyPolicy[language]
  useEffect(() => {
    const required = () => { setForced(true); void refresh() }
    window.addEventListener('privacy:required', required)
    return () => window.removeEventListener('privacy:required', required)
  }, [refresh])
  useEffect(() => { if (initial && session && path !== '/privacy') initialDialogRef.current?.focus({ preventScroll: true }) }, [initial, session, path])

  async function decide(decision: 'accept' | 'reject') {
    if (busy) return
    setBusy(true)
    setDecisionFailure(null)
    const key = `${decision}:${language}`
    if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() }
    try {
      const response = await fetch('/api/privacy/decision', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyVersion: PRIVACY_POLICY_VERSION, surface: 'login', decision, language, requestId: requestRef.current.id }),
      })
      if (!response.ok) {
        // Re-sync the authoritative stage: a conflict may mean the server
        // already recorded another outcome for this session or request.
        await refresh().catch(() => undefined)
        setDecisionFailure({ kind: classifyPrivacyDecisionFailure(response.status), decision })
        return
      }
      if (decision === 'reject') {
        // The atomic decision already revoked this app session and cleared its
        // cookie. Clear the UI without invoking external-provider logout.
        requestRef.current = null
        window.dispatchEvent(new Event('auth:unauthorized'))
        router.replace('/login')
        return
      }
      requestRef.current = null
      setForced(false)
      await refresh()
    } catch {
      await refresh().catch(() => undefined)
      setDecisionFailure({ kind: 'transient', decision })
    } finally { setBusy(false) }
  }

  /** Reintenta una decisión fallida: aceptar no es destructivo y se repite
   * directamente; el rechazo nunca se repite solo, se restaura el estado
   * previo al fallo (la tarjeta con sus botones) para que el usuario vuelva
   * a elegir. */
  function retryFailure() {
    if (decisionFailure === null || busy) return
    const { decision } = decisionFailure
    setDecisionFailure(null)
    if (decision === 'reject') return
    void decide(decision)
  }

  if (path === '/privacy') return children
  if (loading) return (
    <PrivacyPanel className="max-w-sm">
      <div className="flex flex-col items-center space-y-4 text-center" role="status">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" aria-hidden="true" />
        <p className="text-base font-medium text-gray-700">{text.loading}</p>
      </div>
    </PrivacyPanel>
  )
  if (error) return (
    <PrivacyPanel className="max-w-lg">
      <div className="space-y-4 text-center" role="alert">
        <p className="text-base font-medium text-gray-700">{text.unavailable}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button onClick={() => void refresh()} className="rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-4 py-2 font-semibold text-white shadow-lg transition hover:from-blue-700 hover:to-indigo-700">{text.retry}</button>
          <Link href="/privacy" className="rounded-xl border border-blue-200 bg-white px-4 py-2 font-semibold text-blue-700 transition hover:bg-blue-50">{text.policy}</Link>
        </div>
      </div>
    </PrivacyPanel>
  )
  if (!session) return children
  if (initial) return (
    <PrivacyPanel className="max-w-3xl">
      <div
        ref={initialDialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-title"
        aria-busy={busy}
        /* focus:outline-none evita el recuadro de foco del navegador alrededor
         * de la tarjeta tras el foco programático inicial; desaparecía al hacer
         * clic en cualquier parte de la pantalla y no aportaba nada. */
        className="focus:outline-none"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const elements = event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled])')
          const first = elements[0]
          const last = elements[elements.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }}
      >
        <PrivacyNotice />
        {decisionFailure && <DecisionFailureAlert failure={decisionFailure} language={language} onRetry={retryFailure} />}
        <div className="mt-6 flex flex-wrap gap-3">
          <button disabled={busy} className="rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg transition hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50" onClick={() => void decide('accept')}>{text.accept}</button>
          <button disabled={busy} className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50" onClick={() => void decide('reject')}>{text.reject}</button>
        </div>
      </div>
    </PrivacyPanel>
  )
  return children
}
