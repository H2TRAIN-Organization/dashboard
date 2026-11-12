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
function DecisionFailureAlert({ failure, language, onRetry, onEscape, showEscape }: {
  failure: DecisionFailure
  language: 'es' | 'en'
  onRetry: () => void
  onEscape: () => void
  showEscape: boolean
}) {
  const text = privacyPolicy[language]
  const gate = privacyGateText[language]
  const message = failure.kind === 'transient' ? text.unavailable : gate.decisionConflict
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
        {showEscape && (
          <button
            onClick={onEscape}
            className="rounded-xl border border-red-300 bg-white px-4 py-2 font-semibold text-red-700 transition hover:bg-red-50"
          >
            {gate.escape}
          </button>
        )}
      </div>
    </div>
  )
}

export default function PrivacyBoundary({ children }: { children: React.ReactNode }) {
  const { session, loading, error, refresh, logout } = useSession()
  const { language } = useLanguage()
  const path = usePathname()
  const router = useRouter()
  const [forced, setForced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [decisionFailure, setDecisionFailure] = useState<DecisionFailure | null>(null)
  const [conflictStreak, setConflictStreak] = useState(0)
  // Transición de cierre de sesión: mientras se navega a /login no se pinta
  // la aplicación (ni la home ni el gate), evitando el destello previo.
  const [signingOut, setSigningOut] = useState(false)
  const [lastPath, setLastPath] = useState(path)
  if (lastPath !== path) {
    // Ajuste de estado durante el render (patrón React para cambios de props):
    // la transición termina en cuanto el router aterriza en /login.
    setLastPath(path)
    if (signingOut && path === '/login') setSigningOut(false)
  }
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
  // La navegación a /login se lanza tras renderizar el estado de salida.
  useEffect(() => { if (signingOut) router.replace('/login') }, [signingOut, router])

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
        // Re-sync the authoritative stage in the background. With an existing
        // session the gate stays mounted, so the loading card never flashes
        // over the notice while the decision failure is shown.
        const kind = classifyPrivacyDecisionFailure(response.status)
        setConflictStreak((streak) => kind === 'conflict' ? streak + 1 : 0)
        await refresh().catch(() => undefined)
        setDecisionFailure({ kind, decision })
        return
      }
      requestRef.current = null
      setConflictStreak(0)
      setForced(false)
      if (decision === 'reject') {
        // The atomic decision already revoked this app session and cleared its
        // cookie. Enter the sign-out transition before clearing local state so
        // the home is never rendered, and skip the external-provider logout.
        setSigningOut(true)
        window.dispatchEvent(new Event('auth:unauthorized'))
        return
      }
      await refresh()
    } catch {
      setConflictStreak(0)
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

  /** Salida de escape tras conflictos persistentes: logout limpio y vuelta a
   * /login, sin renderizar la aplicación durante la transición. */
  async function escapeToLogin() {
    if (busy || signingOut) return
    setBusy(true)
    setSigningOut(true)
    try { await logout() } finally { setBusy(false) }
  }

  if (signingOut) return null
  if (path === '/privacy') return children
  // Solo la carga inicial sustituye la interfaz por la tarjeta de verificación:
  // con una sesión existente el refresco es de fondo y el aviso no parpadea.
  if (loading && !session) return (
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
        {decisionFailure && (
          <DecisionFailureAlert
            failure={decisionFailure}
            language={language}
            onRetry={retryFailure}
            onEscape={() => void escapeToLogin()}
            showEscape={decisionFailure.kind === 'conflict' && conflictStreak >= 2}
          />
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button disabled={busy} className="rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg transition hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50" onClick={() => void decide('accept')}>{text.accept}</button>
          <button disabled={busy} className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50" onClick={() => void decide('reject')}>{text.reject}</button>
        </div>
      </div>
    </PrivacyPanel>
  )
  return children
}
