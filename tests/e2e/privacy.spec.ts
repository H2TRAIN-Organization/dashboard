import { expect, test, type Page } from '@playwright/test'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '../../src/lib/privacy-policy'

async function mockPrivacy(
  page: Page,
  initialStage: 'initial' | 'banner' | 'complete' = 'initial',
  policy: { readonly version: string; readonly hash: string } = { version: PRIVACY_POLICY_VERSION, hash: PRIVACY_POLICY_HASH },
) {
  let stage = initialStage
  let signedIn = true
  let fail = false
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
      if (fail) return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic offline' } } })
      if (body.decision === 'reject') signedIn = false
      else stage = body.surface === 'login' ? 'banner' : 'complete'
      return route.fulfill({ json: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: stage, rejected: body.decision === 'reject' } })
    }
    if (path === '/api/auth/logout') { logoutCalls++; signedIn = false; return route.fulfill({ status: 204 }) }
    privateReads++
    if (path.startsWith('/api/kubios')) return route.fulfill({ json: { status: 'empty', measurement_count: 0, synced_at: null, latest_result: null, results: [] } })
    if (path.includes('count')) return route.fulfill({ json: { count: 0 } })
    return route.fulfill({ json: { users: [], total: 0, insulinData: [], foodData: [], exerciseData: [], periodData: [], moodData: [] } })
  })
  return { decisions, reads: () => privateReads, logoutCalls: () => logoutCalls, fail: () => { fail = true } }
}

for (const [device, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
  test.describe(`privacy ${device}`, () => {
    test.use({ viewport })
    test('initial gate, keyboard, language and two durable acknowledgements', async ({ page }) => {
      const mock = await mockPrivacy(page)
      await page.goto('/')
      const dialog = page.getByRole('dialog', { name: 'Aviso de privacidad', exact: true })
      await expect(dialog).toBeVisible()
      expect(mock.reads()).toBe(0)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: 'Rechazar y cerrar sesión' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Español' })).toBeFocused()
      await page.screenshot({ path: `test-results/privacy-${device}-initial.png`, fullPage: true })
      await dialog.getByRole('button', { name: 'English', exact: true }).click()
      await page.getByRole('button', { name: 'I have read and accept to continue' }).click()
      const banner = page.getByRole('complementary', { name: 'Privacy notice', exact: true })
      await expect(banner).toBeVisible()
      expect(mock.decisions[0]).toMatchObject({ surface: 'login', decision: 'accept', language: 'en' })
      const bounds = await banner.boundingBox()
      expect(bounds).not.toBeNull()
      expect(Math.abs(bounds!.y + bounds!.height - viewport.height)).toBeLessThan(2)
      await page.screenshot({ path: `test-results/privacy-${device}-banner.png`, fullPage: true })
      await banner.getByRole('button', { name: 'I have read and accept to continue' }).click()
      await expect(banner).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('dialog', { name: 'Privacy notice', exact: true })).toHaveCount(0)
      await expect(page.getByRole('complementary', { name: 'Privacy notice', exact: true })).toHaveCount(0)
      expect(mock.decisions[1]).toMatchObject({ surface: 'banner', decision: 'accept', language: 'en' })
      expect(mock.decisions[1]!.requestId).not.toBe(mock.decisions[0]!.requestId)
    })
    test('banner rejection needs a cancellable confirmation before signing out', async ({ page }) => {
      const mock = await mockPrivacy(page, 'banner')
      await page.goto('/')
      const banner = page.getByRole('complementary', { name: 'Aviso de privacidad', exact: true })
      await banner.getByRole('button', { name: 'Rechazar y cerrar sesión' }).click()
      const dialog = page.getByRole('dialog', { name: 'Rechazar y cerrar sesión', exact: true })
      await expect(dialog).toBeVisible()
      await page.screenshot({ path: `test-results/privacy-${device}-confirm-rejection.png`, fullPage: true })
      expect(mock.decisions).toHaveLength(0)
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(banner).toBeVisible()
      await banner.getByRole('button', { name: 'Rechazar y cerrar sesión' }).click()
      await dialog.getByRole('button', { name: 'Confirmar rechazo', exact: true }).click()
      await expect(page).toHaveURL(/\/login$/)
      expect(mock.decisions).toHaveLength(1)
      expect(mock.logoutCalls()).toBe(0)
      expect(mock.decisions[0]).toMatchObject({ surface: 'banner', decision: 'reject' })
    })
    test('banner rejection recovers its confirmation after a failed decision', async ({ page }) => {
      const mock = await mockPrivacy(page, 'banner')
      mock.fail()
      await page.goto('/')
      const banner = page.getByRole('complementary', { name: 'Aviso de privacidad', exact: true })
      await expect(banner).toBeVisible()
      await banner.getByRole('button', { name: 'Rechazar y cerrar sesión' }).click()
      const dialog = page.getByRole('dialog', { name: 'Rechazar y cerrar sesión', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Confirmar rechazo', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'acceso a datos permanece bloqueado' })).toBeVisible()
      expect(mock.decisions).toHaveLength(1)
      expect(mock.decisions[0]).toMatchObject({ surface: 'banner', decision: 'reject' })
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
      await expect(banner).toBeVisible()
      await banner.getByRole('button', { name: 'Rechazar y cerrar sesión' }).click()
      await expect(dialog).toBeVisible()
      expect(mock.decisions).toHaveLength(1)
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(banner).toBeVisible()
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
      await expect(page.getByRole('link', { name: 'htrain@proton.me', exact: true })).toBeVisible()
    })
  })
}
