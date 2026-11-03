'use client'

import { useLanguage } from '@/contexts/LanguageContext'
import { Globe, Check } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface LanguageSelectorProps {
  compact?: boolean
  /** Abre el menú hacia arriba cuando el selector vive junto al borde inferior. */
  openUp?: boolean
}

export default function LanguageSelector({
  compact = false,
  openUp = false,
}: LanguageSelectorProps) {
  const { language, setLanguage, t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const languages = [
    { code: 'es' as const, name: 'Español', flag: '🇪🇸' },
    { code: 'en' as const, name: 'English', flag: '🇺🇸' }
  ]

  const currentLanguage = languages.find(lang => lang.code === language)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={t.common.language || 'Language'}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          className="flex items-center justify-center w-9 h-9 text-blue-700 bg-white backdrop-blur-sm border border-blue-200 hover:bg-blue-50 rounded-lg transition-all duration-200 hover:scale-105"
          title={t.common.language || 'Language'}
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
        </button>

        {isOpen && (
          <div role="menu" className={`absolute right-0 ${openUp ? 'bottom-full mb-2' : 'mt-2'} w-40 bg-white/95 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 py-2 z-[99999]`}>
            {languages.map((lang) => (
              <button
                key={lang.code}
                type="button"
                role="menuitemradio"
                aria-checked={language === lang.code}
                onClick={() => {
                  setLanguage(lang.code)
                  setIsOpen(false)
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-blue-50 transition-all duration-200 rounded-lg mx-1 ${
                  language === lang.code ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-700 hover:text-blue-600'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className="text-base">{lang.flag}</span>
                  <span className="font-medium text-xs">{lang.name}</span>
                </div>
                {language === lang.code && (
                  <Check className="h-3 w-3 text-blue-600" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={t.common.language || 'Language'}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex items-center space-x-2 px-4 py-3 text-gray-700 bg-white/90 backdrop-blur-sm border border-gray-200/50 hover:bg-blue-50 rounded-xl transition-all duration-200 hover:scale-105 shadow-sm hover:shadow-md"
        title={t.common.language || 'Language'}
      >
        <Globe className="h-5 w-5 text-blue-600" />
        <span className="text-lg">{currentLanguage?.flag}</span>
        <span className="text-sm font-semibold text-gray-800">{currentLanguage?.name}</span>
      </button>

      {isOpen && (
        <div role="menu" className={`absolute right-0 ${openUp ? 'bottom-full mb-2' : 'mt-2'} w-52 bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/50 py-2 z-[99999]`}>
          {languages.map((lang) => (
            <button
              key={lang.code}
              type="button"
              role="menuitemradio"
              aria-checked={language === lang.code}
              onClick={() => {
                setLanguage(lang.code)
                setIsOpen(false)
              }}
              className={`w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-blue-50 transition-all duration-200 rounded-xl mx-1 ${
                language === lang.code ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-700 hover:text-blue-600'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-xl">{lang.flag}</span>
                <span className="font-medium">{lang.name}</span>
              </div>
              {language === lang.code && (
                <Check className="h-4 w-4 text-blue-600" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
