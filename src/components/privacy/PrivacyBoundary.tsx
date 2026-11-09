'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { useSession } from '@/contexts/SessionContext'
import { privacyPolicy, PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/lib/privacy-policy'
import PrivacyNotice from './PrivacyNotice'

export default function PrivacyBoundary({ children }: { children: React.ReactNode }) {
  const { session, loading, error, refresh } = useSession()
  const { language } = useLanguage()
  const path = usePathname()
  const router = useRouter()
  const [forced, setForced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmReject, setConfirmReject] = useState(false)
  const initialDialogRef = useRef<HTMLElement>(null)
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
  }, [stage, loading, failed, session, path])

  async function decide(decision: 'accept' | 'reject') {
    if (busy || (decision === 'reject' && !initial && !confirmReject)) return
    setBusy(true)
    setFailed(false)
    const surface = initial ? 'login' : 'banner'
    const key = `${surface}:${decision}:${language}`
    if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() }
    try {
      const response = await fetch('/api/privacy/decision', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyVersion: PRIVACY_POLICY_VERSION, surface, decision, language, requestId: requestRef.current.id }),
      })
      if (!response.ok) throw new Error('privacy')
      if (decision === 'reject') {
        // The atomic decision already revoked this app session and cleared its
        // cookie. Clear the UI without invoking external-provider logout.
        window.dispatchEvent(new Event('auth:unauthorized'))
        router.replace('/login')
        return
      }
      requestRef.current = null
      setForced(false)
      await refresh()
    } catch { setFailed(true); setConfirmReject(false) } finally { setBusy(false) }
  }

  if (path === '/privacy') return children
  if (loading) return <main className="p-8" role="status">{text.loading}</main>
  if (failed) return <main className="p-8" role="alert">{text.unavailable} <button onClick={() => { setFailed(false); void refresh() }}>{text.retry}</button> <Link href="/privacy">{text.policy}</Link></main>
  if (error) return <main className="p-8" role="alert">{text.unavailable} <button onClick={() => void refresh()}>{text.retry}</button> <Link href="/privacy">{text.policy}</Link></main>
  if (!session) return children
  if (initial) return <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
    <section ref={initialDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="privacy-title" aria-busy={busy} className="mx-auto max-w-3xl rounded-xl bg-white p-5 shadow sm:p-8"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const elements = event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled])')
        const first = elements[0]
        const last = elements[elements.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <PrivacyNotice />
      <div className="mt-6 flex flex-wrap gap-3">
        <button disabled={busy} className="rounded bg-blue-700 px-4 py-3 text-white disabled:opacity-50" onClick={() => void decide('accept')}>{text.accept}</button>
        <button disabled={busy} className="rounded border px-4 py-3" onClick={() => void decide('reject')}>{text.reject}</button>
      </div>
    </section>
  </main>
  return <div style={{ paddingBottom: stage === 'banner' ? bannerHeight : 0 }}>{stage === 'banner' ? <aside ref={bannerRef} aria-label={text.title} className="fixed inset-x-0 bottom-0 z-50 max-h-[65vh] overflow-y-auto border-t border-amber-300 bg-amber-50 p-4 text-slate-900">
    <p>{text.banner} <Link className="underline" href="/privacy">{text.policy}</Link></p>
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
