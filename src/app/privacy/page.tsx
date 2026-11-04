'use client'
import Link from 'next/link'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import PrivacyNotice from '@/components/privacy/PrivacyNotice'

export default function PrivacyPage() {
  const { session, loading, error } = useSession()
  const { language } = useLanguage()
  const states = language === 'es'
    ? { initial: 'lectura inicial pendiente', banner: 'lectura de la barra pendiente', complete: 'lectura completada' }
    : { initial: 'first acknowledgement pending', banner: 'banner acknowledgement pending', complete: 'acknowledgement complete' }
  return <main className="mx-auto max-w-3xl space-y-6 p-5 sm:p-10">
    <PrivacyNotice />
    <p role="status">{language === 'es' ? 'Estado de esta sesión: ' : 'Current session status: '}
      {loading ? '…' : error ? (language === 'es' ? 'no disponible' : 'unavailable') : session ? states[session.privacy?.state ?? 'initial'] : (language === 'es' ? 'sin sesión' : 'signed out')}
    </p>
    <Link className="text-blue-700 underline" href={session ? '/' : '/login'}>{language === 'es' ? 'Volver' : 'Back'}</Link>
  </main>
}
