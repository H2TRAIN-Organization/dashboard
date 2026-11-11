'use client'
import Link from 'next/link'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import PrivacyNotice from '@/components/privacy/PrivacyNotice'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/lib/privacy-policy'

export default function PrivacyPage() {
  const { session, loading, error } = useSession()
  const { language } = useLanguage()
  const privacy = session?.privacy
  const currentPrivacy = privacy?.policyVersion === PRIVACY_POLICY_VERSION && privacy.policyHash === PRIVACY_POLICY_HASH ? privacy : undefined
  const states = language === 'es'
    ? { initial: 'lectura inicial pendiente', complete: 'lectura completada' }
    : { initial: 'first acknowledgement pending', complete: 'acknowledgement complete' }
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Elementos decorativos de fondo, iguales que en el resto del dashboard */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-400 opacity-10 mix-blend-multiply blur-xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-indigo-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-1000"></div>
        <div className="absolute left-1/2 top-40 h-80 w-80 rounded-full bg-purple-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-500"></div>
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-gray-200/50 bg-white/90 p-5 shadow-2xl backdrop-blur-xl sm:p-10">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5" aria-hidden="true"></div>
          <div className="relative z-10 space-y-6">
            <PrivacyNotice />
            <p
              role="status"
              className="rounded-xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm font-medium text-blue-900"
            >
              {language === 'es' ? 'Estado de esta sesión: ' : 'Current session status: '}
              {loading ? '…' : error ? (language === 'es' ? 'no disponible' : 'unavailable') : session ? states[currentPrivacy?.state ?? 'initial'] : (language === 'es' ? 'sin sesión' : 'signed out')}
            </p>
            <Link
              className="inline-flex items-center rounded-xl border border-blue-200 bg-white px-4 py-2 font-semibold text-blue-700 transition hover:bg-blue-50"
              href={session ? '/' : '/login'}
            >
              {language === 'es' ? 'Volver' : 'Back'}
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
