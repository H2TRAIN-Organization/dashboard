import { test as base, expect } from '@playwright/test'

/**
 * MT40: English is the dashboard's default language since the LanguageContext
 * change. The UI contracts were written against the Spanish interface, so the
 * e2e suite pins Spanish explicitly through this fixture instead of repeating
 * an init script inside every mock helper.
 */
/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture API, not a React hook */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      // Only pins the fallback when the user has no stored preference, so
      // tests that switch language and reload observe the persisted choice.
      if (localStorage.getItem('language') === null) {
        localStorage.setItem('language', 'es')
      }
    })
    await use(page)
  },
})
/* eslint-enable react-hooks/rules-of-hooks */

export type { Page } from '@playwright/test'
export { expect }
