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
    ? { initial: 'lectura inicial pendiente', banner: 'lectura de la barra pendiente', complete: 'lectura completada' }
    : { initial: 'first acknowledgement pending', banner: 'banner acknowledgement pending', complete: 'acknowledgement complete' }
  return <main className="mx-auto max-w-3xl space-y-6 p-5 sm:p-10">
    <PrivacyNotice />
    <p role="status">{language === 'es' ? 'Estado de esta sesión: ' : 'Current session status: '}
      {loading ? '…' : error ? (language === 'es' ? 'no disponible' : 'unavailable') : session ? states[currentPrivacy?.state ?? 'initial'] : (language === 'es' ? 'sin sesión' : 'signed out')}
    </p>
    <Link className="text-blue-700 underline" href={session ? '/' : '/login'}>{language === 'es' ? 'Volver' : 'Back'}</Link>
  </main>
}
