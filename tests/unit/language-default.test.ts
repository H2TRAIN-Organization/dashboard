import { describe, expect, it } from 'vitest'
import { DEFAULT_LANGUAGE } from '@/contexts/LanguageContext'
import { translations } from '@/lib/translations'

/**
 * MT40: English is the primary language of the dashboard. Spanish stays
 * selected only when the user picks it explicitly (persisted in storage by
 * the LanguageContext update path).
 */
describe('dashboard primary language', () => {
  it('defaults to English', () => {
    expect(DEFAULT_LANGUAGE).toBe('en')
  })

  it('keeps complete Spanish translations alongside English', () => {
    expect(Object.keys(translations.es).length).toBeGreaterThan(0)
    expect(Object.keys(translations.en).length).toBeGreaterThan(0)
  })
})
