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
  const [confirmReject, setConfirmReject] = useState(false)
  const initialDialogRef = useRef<HTMLDivElement>(null)
  const rejectDialogRef = useRef<HTMLDialogElement>(null)
  const bannerRef = useRef<HTMLElement>(null)
  const [bannerHeight, setBannerHeight] = useState(288)
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
  useEffect(() => {
    if (confirmReject) rejectDialogRef.current?.showModal()
    else rejectDialogRef.current?.close()
  }, [confirmReject])
  useEffect(() => {
    const banner = bannerRef.current
    if (!banner) return
    const update = () => setBannerHeight(banner.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(banner)
    return () => observer.disconnect()
  }, [stage, loading, decisionFailure, session, path])

  async function decide(decision: 'accept' | 'reject') {
    if (busy || (decision === 'reject' && !initial && !confirmReject)) return
    setBusy(true)
    setDecisionFailure(null)
    const surface = initial ? 'login' : 'banner'
    const key = `${surface}:${decision}:${language}`
    if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() }
    try {
      const response = await fetch('/api/privacy/decision', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyVersion: PRIVACY_POLICY_VERSION, surface, decision, language, requestId: requestRef.current.id }),
      })
      if (!response.ok) {
        // Re-sync the authoritative stage: a conflict may mean the server
        // already recorded another outcome for this session or request.
        setConfirmReject(false)
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
      setConfirmReject(false)
      await refresh().catch(() => undefined)
      setDecisionFailure({ kind: 'transient', decision })
    } finally { setBusy(false) }
  }

  /** Reintenta una decisión fallida. El rechazo nunca se repite solo: se
   * restaura el estado previo al fallo (diálogo o barra con sus botones y,
   * en la barra, la confirmación) para que el usuario vuelva a elegir;
   * aceptar no es destructivo y se repite directamente. */
  function retryFailure() {
    if (decisionFailure === null || busy) return
    setDecisionFailure(null)
    if (decisionFailure.decision === 'reject') {
      if (!initial) setConfirmReject(false)
      return
    }
    void decide(decisionFailure.decision)
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
  return <div style={{ paddingBottom: stage === 'banner' ? bannerHeight : 0 }}>{stage === 'banner' ? <aside ref={bannerRef} aria-label={text.title} className="fixed inset-x-0 bottom-0 z-50 max-h-[65vh] overflow-y-auto border-t border-amber-300 bg-amber-50 p-4 text-slate-900">
    <p>{text.banner} <Link className="underline" href="/privacy">{text.policy}</Link></p>
    {decisionFailure && <DecisionFailureAlert failure={decisionFailure} language={language} onRetry={retryFailure} />}
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button disabled={busy} className="rounded bg-blue-700 px-3 py-2 text-white" onClick={() => void decide('accept')}>{text.accept}</button>
      <button disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50" onClick={() => setConfirmReject(true)}>{text.reject}</button>
    </div>
  </aside> : null}{children}
    <dialog ref={rejectDialogRef} aria-labelledby="privacy-reject-title" onCancel={() => setConfirmReject(false)} className="m-auto max-w-lg rounded-xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50">
      <h2 id="privacy-reject-title" className="text-lg font-semibold">{text.reject}</h2>
      <p className="my-4">{text.confirm}</p>
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="rounded border px-4 py-2" onClick={() => setConfirmReject(false)}>{language === 'es' ? 'Cancelar' : 'Cancel'}</button>
        <button disabled={busy} className="rounded bg-red-700 px-4 py-2 text-white" onClick={() => void decide('reject')}>{language === 'es' ? 'Confirmar rechazo' : 'Confirm rejection'}</button>
      </div>
    </dialog>
  </div>
}
