import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract T12: the "General Activity by Date" chart scrolls horizontally
 * when there are many dates instead of squeezing every label into the visible
 * width. Runs only against an explicitly provided base URL with
 * browser-mocked APIs.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const SESSION = {
  user: { id: '1', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
  method: 'username' as const,
  expiresAt: '2030-01-01T00:00:00Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
};

function dayOffsetUtc(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function foodRowsFor(dayCount: number) {
  return Array.from({ length: dayCount }, (_, index) => ({
    username: 'synthetic-participant',
    food_type: 'Desayuno',
    quantity: 'Lo mismo que habitualmente',
    carbs: '40',
    date_time: `${dayOffsetUtc('2026-09-01', index)}T08:00:00.000Z`,
    rowKey: `meal-${index}`,
  }));
}

async function mockActivity(page: Page, dayCount: number) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: SESSION });
    if (path.startsWith('/api/users')) return route.fulfill({ json: { users: [], total: 0 } });
    if (path === '/api/decrypted-data') {
      return route.fulfill({ json: {
        users: [],
        total: 0,
        insulinData: [],
        foodData: foodRowsFor(dayCount),
        exerciseData: [],
        periodData: [],
        moodData: [],
      } });
    }
    return route.fulfill({ json: {} });
  });
}

async function scrollMetrics(page: Page): Promise<{ scrollWidth: number; clientWidth: number; maxScrollLeft: number }> {
  const card = page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Actividad General por Fecha' }) }).last();
  await expect(card).toBeVisible();
  const scrollable = card.locator('.overflow-auto');
  return scrollable.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    maxScrollLeft: element.scrollWidth - element.clientWidth,
  }));
}

test('the general activity chart scrolls horizontally with many dates', async ({ page }) => {
  await mockActivity(page, 40);
  await page.goto('/analytics');

  const metrics = await scrollMetrics(page);
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.maxScrollLeft).toBeGreaterThan(0);

  // The viewport really slides over the inner chart.
  const card = page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Actividad General por Fecha' }) }).last();
  const scrollable = card.locator('.overflow-auto');
  await scrollable.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  const scrolled = await scrollable.evaluate((element) => element.scrollLeft);
  expect(scrolled).toBeGreaterThan(0);
});

test('with few dates the chart stays fitted and does not scroll', async ({ page }) => {
  await mockActivity(page, 3);
  await page.goto('/analytics');

  const metrics = await scrollMetrics(page);
  expect(metrics.maxScrollLeft).toBe(0);
});
