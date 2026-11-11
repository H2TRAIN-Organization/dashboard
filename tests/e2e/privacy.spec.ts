import { expect, test, type Page } from '@playwright/test'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '../../src/lib/privacy-policy'

async function mockPrivacy(
  page: Page,
  initialStage: 'initial' | 'complete' = 'initial',
  policy: { readonly version: string; readonly hash: string } = { version: PRIVACY_POLICY_VERSION, hash: PRIVACY_POLICY_HASH },
) {
  let stage = initialStage
  let signedIn = true
  let fail = false
  let failureStatus = 503
  let privateReads = 0
  let logoutCalls = 0
  const decisions: Array<Record<string, unknown>> = []
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') {
      return route.fulfill(signedIn ? { json: {
        user: { id: '42', username: 'synthetic_participant', email: null, role: 'user', uuid: null, gdprConsent: true, gdprConsentAt: '2026-01-01T00:00:00Z', createdAt: null },
        method: 'username', expiresAt: '2030-01-01T00:00:00Z',
        privacy: { policyVersion: policy.version, policyHash: policy.hash, state: stage },
      } } : { status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Synthetic signed out' } } })
    }
    if (path === '/api/privacy/decision') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      decisions.push(body)
      if (fail) return route.fulfill({ status: failureStatus, json: { error: { code: failureStatus === 409 ? 'CONFLICT' : 'SERVICE_UNAVAILABLE', message: 'Synthetic decision failure' } } })
      if (body.decision === 'reject') signedIn = false
      else stage = 'complete'
      return route.fulfill({ json: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: stage, rejected: body.decision === 'reject' } })
    }
    if (path === '/api/auth/logout') { logoutCalls++; signedIn = false; return route.fulfill({ status: 204 }) }
    privateReads++
    if (path.startsWith('/api/kubios')) return route.fulfill({ json: { status: 'empty', measurement_count: 0, synced_at: null, latest_result: null, results: [] } })
    if (path.includes('count')) return route.fulfill({ json: { count: 0 } })
    return route.fulfill({ json: { users: [], total: 0, insulinData: [], foodData: [], exerciseData: [], periodData: [], moodData: [] } })
  })
  return { decisions, reads: () => privateReads, logoutCalls: () => logoutCalls, succeed: () => { fail = false }, fail: (status = 503) => { fail = true; failureStatus = status } }
}

for (const [device, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
  test.describe(`privacy ${device}`, () => {
    test.use({ viewport })
    test('initial gate, keyboard, language and one durable acknowledgement', async ({ page }) => {
      const mock = await mockPrivacy(page)
      await page.goto('/')
      const dialog = page.getByRole('dialog', { name: 'Aviso de privacidad', exact: true })
      await expect(dialog).toBeVisible()
      expect(mock.reads()).toBe(0)
      // The card receives a programmatic focus on sign-in; the browser focus
      // outline (the black rectangle around the card) must not be painted.
      const outline = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        return active ? getComputedStyle(active).outlineStyle : ''
      })
      expect(outline).toBe('none')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: 'Rechazar y cerrar sesión' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Español' })).toBeFocused()
      await page.screenshot({ path: `test-results/privacy-${device}-initial.png`, fullPage: true })
      await dialog.getByRole('button', { name: 'English', exact: true }).click()
      await page.getByRole('button', { name: 'I have read and accept to continue' }).click()
      expect(mock.decisions[0]).toMatchObject({ surface: 'login', decision: 'accept', language: 'en' })
      // Single-stage: the gate disappears immediately, no bottom banner exists.
      await expect(page.getByRole('dialog', { name: 'Privacy notice', exact: true })).toHaveCount(0)
      await expect(page.getByRole('complementary', { name: /Privacy notice|Aviso de privacidad/ })).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('dialog', { name: 'Privacy notice', exact: true })).toHaveCount(0)
      expect(mock.decisions).toHaveLength(1)
    })
    test('initial popup rejection signs the user out without private reads', async ({ page }) => {
      const mock = await mockPrivacy(page)
      await page.goto('/')
      const dialog = page.getByRole('dialog', { name: 'Aviso de privacidad', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Rechazar y cerrar sesión' }).click()
      await expect(page).toHaveURL(/\/login$/)
      expect(mock.decisions).toHaveLength(1)
      expect(mock.decisions[0]).toMatchObject({ surface: 'login', decision: 'reject', language: 'es', requestId: expect.any(String) })
      expect(mock.logoutCalls()).toBe(0)
      expect(mock.reads()).toBe(0)
    })
    test('initial popup rejection can be retried after a failed decision', async ({ page }) => {
      const mock = await mockPrivacy(page)
      mock.fail()
      await page.goto('/')
      const dialog = page.getByRole('dialog', { name: 'Aviso de privacidad', exact: true })
      await dialog.getByRole('button', { name: 'Rechazar y cerrar sesión' }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'acceso a datos permanece bloqueado' })).toBeVisible()
      expect(mock.decisions).toHaveLength(1)
      mock.succeed()
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Rechazar y cerrar sesión' }).click()
      await expect(page).toHaveURL(/\/login$/)
      expect(mock.decisions).toHaveLength(2)
      expect(mock.reads()).toBe(0)
    })
    test('a conflicting decision keeps the gate with an inline conflict alert and recovers', async ({ page }) => {
      const mock = await mockPrivacy(page)
      mock.fail(409)
      await page.goto('/')
      const dialog = page.getByRole('dialog', { name: 'Aviso de privacidad', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'He leído y acepto continuar' }).click()
      const alert = page.getByRole('alert').filter({ hasText: 'conflicto del servidor' })
      await expect(alert).toBeVisible()
      await expect(dialog).toBeVisible()
      expect(mock.decisions).toHaveLength(1)
      mock.succeed()
      await alert.getByRole('button', { name: 'Reintentar', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Privacy notice', exact: true })).toHaveCount(0)
      await expect(alert).toHaveCount(0)
      expect(mock.decisions[0]).toMatchObject({ surface: 'login', decision: 'accept' })
    })
    test('the user panel links its privacy policy section', async ({ page }) => {
      await mockPrivacy(page, 'complete')
      await page.goto('/')
      await page.getByRole('link', { name: /Política de privacidad/ }).click()
      await expect(page).toHaveURL(/\/privacy$/)
      await expect(page.getByRole('heading', { name: 'Aviso de privacidad', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'h2train@proton.me', exact: true })).toBeVisible()
    })
    test('an already acknowledged account signs in straight to the data', async ({ page }) => {
      await mockPrivacy(page, 'complete')
      await page.goto('/')
      await expect(page.getByRole('dialog', { name: /Aviso de privacidad|Privacy notice/ })).toHaveCount(0)
      await expect(page.getByRole('complementary', { name: /Aviso de privacidad|Privacy notice/ })).toHaveCount(0)
    })
    for (const stale of [
      { name: 'version', version: '2026-01-01-obsolete', hash: PRIVACY_POLICY_HASH },
      { name: 'hash', version: PRIVACY_POLICY_VERSION, hash: 'obsolete-hash' },
    ]) {
      test(`public policy shows initial for an obsolete policy ${stale.name}`, async ({ page }) => {
        await mockPrivacy(page, 'complete', { version: stale.version, hash: stale.hash })
        await page.goto('/privacy')
        const status = page.getByRole('status')
        await expect(status).toContainText('lectura inicial pendiente')
        await expect(status).not.toContainText('lectura completada')
      })
    }
    test('failed decision blocks data and public policy remains accessible', async ({ page }) => {
      const mock = await mockPrivacy(page)
      mock.fail()
      await page.goto('/')
      await page.getByRole('button', { name: 'He leído y acepto continuar' }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'acceso a datos permanece bloqueado' })).toBeVisible()
      expect(mock.reads()).toBe(0)
      await page.getByRole('link', { name: 'Consultar aviso y contacto' }).click()
      await expect(page).toHaveURL(/\/privacy$/)
      await expect(page.getByRole('heading', { name: 'Aviso de privacidad', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'h2train@proton.me', exact: true })).toBeVisible()
    })
  })
}
