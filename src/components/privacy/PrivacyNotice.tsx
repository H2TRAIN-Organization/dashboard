'use client'
import { useLanguage } from '@/contexts/LanguageContext'
import { privacyPolicy, PRIVACY_POLICY_VERSION } from '@/lib/privacy-policy'

export default function PrivacyNotice() {
  const { language, setLanguage } = useLanguage()
  const text = privacyPolicy[language]
  return <article className="space-y-4 leading-relaxed">
    <div className="flex gap-3" aria-label="Language / Idioma">
      <button type="button" aria-pressed={language === 'es'} onClick={() => setLanguage('es')} className="underline">Español</button>
      <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')} className="underline">English</button>
    </div>
    <h1 className="text-2xl font-semibold" id="privacy-title">{text.title}</h1>
    <p className="text-sm text-slate-500">{PRIVACY_POLICY_VERSION}</p>
    {text.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    <a className="text-blue-700 underline" href="mailto:htrain@proton.me">htrain@proton.me</a>
  </article>
}
