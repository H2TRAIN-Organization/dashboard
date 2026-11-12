'use client'
import { ShieldCheck } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { privacyPolicy, PRIVACY_POLICY_VERSION } from '@/lib/privacy-policy'

/** Único correo de contacto para privacidad/GDPR en todo el dashboard. */
export const PRIVACY_CONTACT_EMAIL = 'h2train@proton.me'

const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
] as const

export default function PrivacyNotice() {
  const { language, setLanguage } = useLanguage()
  const text = privacyPolicy[language]
  return (
    <article className="space-y-5 leading-relaxed">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <div className="p-2.5 sm:p-3 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl sm:rounded-2xl shadow-lg">
            <ShieldCheck className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900" id="privacy-title">{text.title}</h1>
        </div>
        <div className="flex gap-2" aria-label="Language / Idioma">
          {LANGUAGES.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              aria-pressed={language === code}
              onClick={() => setLanguage(code)}
              className={
                language === code
                  ? 'rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 px-3 py-1.5 text-sm font-semibold text-white shadow-md'
                  : 'rounded-lg border border-blue-200 bg-white/80 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors'
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-medium text-gray-600">{PRIVACY_POLICY_VERSION}</p>
      {text.paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-sm sm:text-base text-gray-700">{paragraph}</p>
      ))}
      <a
        className="inline-flex items-center rounded-xl border border-blue-200 bg-white/80 px-4 py-2 text-sm sm:text-base font-semibold text-blue-700 underline hover:bg-blue-50 transition-colors"
        href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
      >
        {PRIVACY_CONTACT_EMAIL}
      </a>
    </article>
  )
}
