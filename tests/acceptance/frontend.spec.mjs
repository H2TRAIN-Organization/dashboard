import { test, expect } from '@playwright/test'
import { installFrontendApiMock, loginEmail, loginUsername, waitForHydration } from './support/frontend-api-mock.mjs'

/**
 * Frontend API-mock suite. Next itself runs on the shared Root 4630 server,
 * but every /api/** request is intercepted per test. This file is not
 * backend-real evidence; frontend-real.spec.mjs is the separate real suite.
 */
test.describe.configure({ mode: 'serial' })

const appOrigin = 'http://localhost:4630'

async function chooseLanguage(page, languageName) {
  await page.locator('button[title="Idioma"]:visible, button[title="Language"]:visible').first().click()
  await page.getByRole('button', { name: new RegExp(languageName, 'i') }).last().click()
}

function calendarTrigger(page) {
  return page
    .locator('button')
    .filter({ has: page.locator('svg.lucide-calendar') })
    .first()
}

function expectPopupInside(box, viewport) {
  expect(box).not.toBeNull()
  expect(box.x).toBeGreaterThanOrEqual(7.5)
  expect(box.y).toBeGreaterThanOrEqual(7.5)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7.5)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7.5)
}

async function openCalendar(page) {
  const button = calendarTrigger(page)
  await expect(button).toContainText('Seleccionar fecha')
  await button.click()
  const calendar = page.locator('div.fixed').filter({
    has: page.getByRole('button', { name: 'Cerrar' }),
  })
  await expect(calendar).toBeVisible()
  return {
    button,
    calendar,
    popup: calendar.locator('div.w-80'),
  }
}

async function chooseDataFilters(page) {
  const filters = page.locator('select')
  await expect(filters.nth(0).locator('option[value="doctor.demo"]')).toHaveCount(1)
  await filters.nth(0).selectOption('doctor.demo')
  await filters.nth(1).selectOption('insulin')
  await filters.nth(2).selectOption('7d')
  await expect.poll(() => mock.dataRequests.at(-1)).toMatchObject({
    selectedUser: 'doctor.demo',
    selectedDataType: 'insulin',
    timeRange: '7d',
    dateFilter: null,
  })
  return filters
}

async function chooseCalendarDay(calendar) {
  const monthHeading = calendar.locator('h3')
  const firstMonth = (await monthHeading.textContent()) ?? ''
  await calendar.locator('button').nth(1).click()
  await expect(monthHeading).not.toHaveText(firstMonth)

  const todayDay = new Date().getDate()
  const targetDay = todayDay === 15 ? 14 : 15
  const targetDayButton = calendar
    .locator('div.grid.grid-cols-7.gap-2')
    .last()
    .locator('button.text-slate-700')
    .filter({ hasText: new RegExp(`^${targetDay}$`) })
  await expect(targetDayButton).toHaveCount(1)
  await targetDayButton.click()
  await expect(calendar).toHaveCount(0)
  return targetDay
}

async function assertCalendarFilters(page, filters, targetDay) {
  await expect.poll(() => mock.dataRequests.at(-1)).toMatchObject({
    selectedUser: 'doctor.demo',
    selectedDataType: 'insulin',
    timeRange: '7d',
  })
  await expect
    .poll(() => mock.dataRequests.at(-1)?.dateFilter)
    .toMatch(new RegExp(`^\\d{4}-\\d{2}-${String(targetDay).padStart(2, '0')}$`))
  await expect(filters.nth(0)).toHaveValue('doctor.demo')
  await expect(filters.nth(1)).toHaveValue('insulin')
  await expect(filters.nth(2)).toHaveValue('7d')
}

async function clearCalendarFilters(page, filters, dateButton) {
  await page.getByRole('button', { name: /Limpiar filtros/ }).click()
  await expect.poll(() => mock.dataRequests.at(-1)).toMatchObject({
    selectedUser: 'all',
    selectedDataType: 'all',
    timeRange: 'all',
    dateFilter: null,
  })
  await expect(filters.nth(0)).toHaveValue('all')
  await expect(filters.nth(1)).toHaveValue('all')
  await expect(filters.nth(2)).toHaveValue('all')
  await expect(dateButton).toContainText('Seleccionar fecha')
}

let mock

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: appOrigin,
  })
  mock = installFrontendApiMock(page)
})

test.afterEach(async ({ page }) => {
  await page.close()
  expect(mock.externalRequests).toEqual([])
})

test('email login redirects home and exposes admin menus', async ({ page, context }) => {
  await loginEmail(page)
  await expect(page).toHaveURL(`${appOrigin}/`)
  await expect(page.locator('a[href="/users"]').first()).toBeVisible()
  await expect(page.locator('a[href="/admin"]').first()).toBeVisible()
  await expect(page.getByText('Administrador').first()).toBeVisible()
  const cookie = (await context.cookies(appOrigin)).find((item) => item.name === 'dashboard_session')
  expect(cookie?.httpOnly).toBe(true)

  await page.getByRole('button', { name: /Cerrar sesi.n/i }).last().click()
  await page.waitForURL('**/login')
  expect((await context.cookies(appOrigin)).some((item) => item.name === 'dashboard_session')).toBe(false)
  await page.goto('/app-dashboard')
  await page.waitForURL('**/app-login')
})

test('Next image query, Kubios home card and graphic routes remain present', async ({ page }) => {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  const logo = page.getByAltText('H2TRAIN Logo').first()
  await expect(logo).toBeVisible()
  expect(await logo.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)

  await loginEmail(page)
  const kubiosCard = page.locator('a[href="/kubios"]').first()
  await expect(kubiosCard).toBeVisible()
  await expect(kubiosCard).toContainText('Kubios HRV')
  await expect(kubiosCard).toContainText('1')

  await page.goto('/analytics')
  await expect(page.locator('h1:visible').filter({ hasText: 'Análisis Avanzado' }).last()).toBeVisible()
  await expect(page.getByRole('application').first()).toBeVisible()

  await page.goto('/data')
  await expect(page.locator('h1:visible').filter({ hasText: 'Datos de Salud' }).last()).toBeVisible()

  await page.goto('/overview')
  await expect(page.locator('h1:visible').filter({ hasText: 'Resumen General del Sistema' }).last()).toBeVisible()
})

test('username login redirects app dashboard and invalid credentials show error', async ({ page }) => {
  await page.goto('/app-login')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await page.locator('#username').fill('user.demo')
  await page.locator('#password').fill('wrong')
  await page.locator('button[type="submit"]').click()
  await expect(page.getByText('Credenciales inválidas')).toBeVisible()
  await expect(page).toHaveURL(/\/app-login$/)

  await page.locator('#password').fill('demo')
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/app-dashboard')
  await expect(page.getByText('user.demo').first()).toBeVisible()

  await page.getByRole('button', { name: /Cerrar sesi.n/i }).last().click()
  await page.waitForURL('**/app-login')
  await page.goto('/')
  await page.waitForURL('**/login')
})

test('users admin list, search, create, edit GDPR, role, UUID copy/clear and 409 delete', async ({ page, context }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await loginEmail(page)
  await page.goto('/users')
  await expect(page.locator('tbody tr', { hasText: 'admin.demo' })).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'doctor.demo' })).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'has.data' })).toBeVisible()

  const search = page.getByPlaceholder('Buscar usuarios...')
  await search.fill('doctor')
  await expect(page.locator('tbody tr', { hasText: 'doctor.demo' })).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'admin.demo' })).toHaveCount(0)
  await search.fill('')

  await page.getByRole('button', { name: /Crear Usuario/ }).click()
  const createModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Crear Nuevo Usuario' })
  await createModal.locator('input[type="text"]').fill('new.demo')
  await createModal.locator('input[type="password"]').fill('demo-pass')
  await createModal.locator('select').selectOption('doctor')
  await createModal.locator('button[type="submit"]').click()
  await expect(page.getByText('Usuario creado exitosamente')).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'new.demo' })).toBeVisible()

  const userRow = page.locator('tbody tr', { hasText: 'user.demo' })
  await userRow.locator('button[title="Editar"]').click()
  const editModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Editar Usuario' })
  await editModal.locator('#gdpr-consent').check()
  await editModal.getByRole('button', { name: /Guardar/ }).click()
  await expect(page.getByText('Usuario actualizado exitosamente')).toBeVisible()

  const doctorRow = page.locator('tbody tr', { hasText: 'doctor.demo' })
  await doctorRow.locator('select').selectOption('admin')
  await expect(page.getByText('Rol actualizado exitosamente')).toBeVisible()
  await expect(doctorRow.locator('select')).toHaveValue('admin')

  const adminRow = page.locator('tbody tr', { hasText: 'admin.demo' })
  await adminRow.locator('button[title="Copiar UUID"]').click()
  await expect(page.getByText('UUID copiado al portapapeles')).toBeVisible()
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toBe('uuid-admin')

  await adminRow.locator('button[title="Limpiar UUID"]').click()
  await expect(page.getByText('UUID limpiado exitosamente')).toBeVisible()
  await expect(adminRow.getByText('Sin UUID')).toBeVisible()

  const dataRow = page.locator('tbody tr', { hasText: 'has.data' })
  await dataRow.locator('button[title="Eliminar"]').click()
  await expect(page.getByText('No se puede eliminar un usuario con datos')).toBeVisible()
  await expect(dataRow).toBeVisible()

  const newRow = page.locator('tbody tr', { hasText: 'new.demo' })
  await newRow.locator('button[title="Eliminar"]').click()
  await expect(page.getByText('Usuario eliminado exitosamente')).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'new.demo' })).toHaveCount(0)
})

test('users list exposes loading state before rendering', async ({ page }) => {
  await loginEmail(page)
  mock.setListDelay(900)
  await page.goto('/users')
  await expect(page.getByText('Cargando usuarios...')).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'admin.demo' })).toBeVisible()
})

test('doctor sees global users read-only and no admin menu', async ({ page }) => {
  await loginUsername(page, 'doctor.demo')
  await page.goto('/users')
  await expect(page.locator('tbody tr', { hasText: 'admin.demo' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Crear Usuario/ })).toHaveCount(0)
  await expect(page.locator('tbody tr button[title="Editar"]')).toHaveCount(0)
  await expect(page.locator('tbody tr button[title="Eliminar"]')).toHaveCount(0)
  await expect(page.locator('tbody tr select')).toHaveCount(0)

  await page.goto('/')
  await expect(page.locator('a[href="/users"]').first()).toBeVisible()
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0)
  await page.goto('/admin')
  await expect(page.getByText('Permisos Insuficientes')).toBeVisible()
})

test('user sees only self, no admin menu, and admin route is denied', async ({ page }) => {
  await loginUsername(page, 'user.demo')
  await page.goto('/users')
  await expect(page.locator('tbody tr', { hasText: 'user.demo' })).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'admin.demo' })).toHaveCount(0)
  await expect(page.locator('tbody tr', { hasText: 'has.data' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Crear Usuario/ })).toHaveCount(0)
  await expect(page.locator('tbody tr button[title="Editar"]')).toHaveCount(0)

  await page.goto('/')
  await expect(page.locator('a[href="/users"]')).toHaveCount(0)
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0)
  await page.goto('/admin')
  await expect(page.getByText('Permisos Insuficientes')).toBeVisible()
})

test('data calendar navigates, applies a day filter, keeps filters, and clears them', async ({ page }) => {
  await loginEmail(page)

  const desktop = { width: 1440, height: 1000 }
  await page.setViewportSize(desktop)
  await page.goto('/data')
  await expect(page.locator('h1:visible').filter({ hasText: 'Datos de Salud' }).last()).toBeVisible()
  let filters = await chooseDataFilters(page)
  let opened = await openCalendar(page)
  let popupBox = await opened.popup.boundingBox()
  expectPopupInside(popupBox, desktop)
  let targetDay = await chooseCalendarDay(opened.calendar)
  await assertCalendarFilters(page, filters, targetDay)
  await expect(opened.button).not.toHaveText(/Seleccionar fecha/)
  await clearCalendarFilters(page, filters, opened.button)

  const mobile = { width: 375, height: 812 }
  await page.setViewportSize(mobile)
  await page.goto('/data')
  await expect(page.locator('h1:visible').filter({ hasText: 'Datos de Salud' }).last()).toBeVisible()
  filters = await chooseDataFilters(page)
  const mobileTrigger = calendarTrigger(page)
  await mobileTrigger.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    window.scrollBy(0, rect.bottom - window.innerHeight + 48)
  })
  const mobileTriggerBox = await mobileTrigger.boundingBox()
  expect(mobileTriggerBox).not.toBeNull()
  opened = await openCalendar(page)
  popupBox = await opened.popup.boundingBox()
  expectPopupInside(popupBox, mobile)
  expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(mobileTriggerBox.y - 4)
  targetDay = await chooseCalendarDay(opened.calendar)
  await assertCalendarFilters(page, filters, targetDay)
  await clearCalendarFilters(page, filters, opened.button)

  const landscape = { width: 667, height: 375 }
  await page.setViewportSize(landscape)
  await page.goto('/data')
  await expect(page.locator('h1:visible').filter({ hasText: 'Datos de Salud' }).last()).toBeVisible()
  filters = await chooseDataFilters(page)
  opened = await openCalendar(page)
  const beforeResize = await opened.popup.boundingBox()
  expectPopupInside(beforeResize, landscape)
  await page.setViewportSize({ width: 667, height: 667 })
  await expect
    .poll(async () => (await opened.popup.boundingBox())?.height ?? 0)
    .toBeGreaterThan(beforeResize.height)
  const afterResize = await opened.popup.boundingBox()
  expectPopupInside(afterResize, { width: 667, height: 667 })
  await page.getByRole('button', { name: 'Cerrar' }).click()
})

test('language toggle persists reload and protected loading stays behind the guard', async ({ page }) => {
  await loginEmail(page)
  await expect(page.getByRole('heading', { name: 'Gestión de Usuarios' })).toBeVisible()

  await chooseLanguage(page, 'English')
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible()
  expect(await page.evaluate(() => window.localStorage.getItem('language'))).toBe('en')

  mock.setSessionDelay(1000)
  await page.reload()
  await expect(page.getByText('Cargando...', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(`${appOrigin}/`)
  await expect(page.locator('a[href="/users"]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible()
  await expect(page).toHaveURL(`${appOrigin}/`)
  await expect(page.locator('button[title="Language"]:visible').first()).toBeVisible()

  const stored = await page.evaluate(() => window.localStorage.getItem('language'))
  expect(stored).toBe('en')
})

test('blocked storage does not throw and language falls back in memory', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('Storage blocked by fixture', 'SecurityError')
    }
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value: blocked,
      })
    }
  })

  await page.goto('/login')
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()

  await chooseLanguage(page, 'English')
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  expect(pageErrors).toEqual([])
})
