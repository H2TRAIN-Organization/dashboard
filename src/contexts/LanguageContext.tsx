'use client'

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Language, translations } from '@/lib/translations'

const DEFAULT_LANGUAGE: Language = 'es'
const LANGUAGE_STORAGE_KEY = 'language'
const listeners = new Set<() => void>()

function isLanguage(value: string | null): value is Language {
  return value === 'es' || value === 'en'
}

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE

  try {
    const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(savedLanguage) ? savedLanguage : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

let currentLanguage: Language = readStoredLanguage()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Language {
  return currentLanguage
}

function getServerSnapshot(): Language {
  return DEFAULT_LANGUAGE
}

function updateLanguage(language: Language) {
  currentLanguage = language
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Storage can be unavailable; the in-memory preference still applies.
  }

  for (const listener of listeners) listener()
}

interface LanguageContextType {
  language: Language
  setLanguage: (language: Language) => void
  t: typeof translations.es
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )
  const t = translations[language]

  return (
    <LanguageContext.Provider value={{ language, setLanguage: updateLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
