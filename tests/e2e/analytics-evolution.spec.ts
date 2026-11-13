import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract T11: the time-evolution charts draw their series, not just the
 * frame. The rows fed to the LineCharts must expose the `date` axis key the
 * charts read; a missing key made recharts drop every line. Runs only against
 * an explicitly provided base URL with browser-mocked APIs.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const EVOLUTION_DATES = ['2026-11-01', '2026-11-02', '2026-11-03'];

const INSULIN = EVOLUTION_DATES.map((date, index) => ({
  username: 'synthetic-participant',
  insulinType: 'Rápida',
  dose: '2',
  carbs: '10',
  date_time: `${date}T08:00:00.000Z`,
  rowKey: `insulin-${index}`,
}));
const FOOD = EVOLUTION_DATES.map((date, index) => ({
  username: 'synthetic-participant',
  food_type: 'Desayuno',
  quantity: 'Lo mismo que habitualmente',
  carbs: '40',
  date_time: `${date}T08:30:00.000Z`,
  rowKey: `meal-${index}`,
}));
const EXERCISE = EVOLUTION_DATES.map((date, index) => ({
  username: 'synthetic-participant',
  exercise_type: 'Aeróbico',
  exercise_description: 'Caminata rápida de 45 minutos',
  date_time: `${date}T18:00:00.000Z`,
  rowKey: `exercise-${index}`,
}));
const MOOD = EVOLUTION_DATES.map((date, index) => ({
  username: 'synthetic-participant',
  mood_value: '8',
  date_time: `${date}T20:00:00.000Z`,
  rowKey: `mood-${index}`,
}));

const SESSION = {
  user: { id: '1', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
  method: 'username' as const,
  expiresAt: '2030-01-01T00:00:00Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
};

async function mockAnalytics(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: SESSION });
    if (path.startsWith('/api/users')) return route.fulfill({ json: { users: [], total: 0 } });
    if (path === '/api/decrypted-data') {
      return route.fulfill({ json: {
        users: [],
        total: 0,
        insulinData: INSULIN,
        foodData: FOOD,
        exerciseData: EXERCISE,
        periodData: [],
        moodData: MOOD,
      } });
    }
    return route.fulfill({ json: {} });
  });
}

const EVOLUTION_CARDS = [
  { heading: 'Evolución de Registros de Insulina', color: '#3B82F6' },
  { heading: 'Evolución de Registros de Comidas', color: '#10B981' },
  { heading: 'Evolución de Registros de Ejercicio', color: '#F59E0B' },
  { heading: 'Evolución de Registros de Estado de Ánimo', color: '#EC4899' },
];

test('every time-evolution chart draws its line, not just the frame', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');

  for (const card of EVOLUTION_CARDS) {
    const cardLocator = page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: card.heading }) }).last();
    await expect(cardLocator.getByRole('heading', { name: card.heading })).toBeVisible();

    // The series exists: the line path of the evolution chart is rendered
    // (recharts animates the draw, so visibility alone is not stable here).
    const line = cardLocator.locator('path.recharts-curve.recharts-line-curve');
    await expect(line).toHaveCount(1);
    await expect(line).toHaveAttribute('stroke', card.color);
    await expect(line).toHaveAttribute('d', /C/);
  }
});

test('evolution charts keep the per-day axis with real date labels', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');

  const insulinCard = page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Evolución de Registros de Insulina' }) }).last();
  const ticks = insulinCard.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value');
  await expect(ticks).toHaveCount(3);
  await expect(ticks.first()).toContainText(/1/);
  await expect(ticks.nth(1)).toContainText(/2/);
  await expect(ticks.nth(2)).toContainText(/3/);
});

test('daily injections bars are positioned on the date axis', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');

  // Same root cause as the evolution charts: the daily bar chart reads the
  // `date` axis key from rows that must provide it.
  const injectionsCard = page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Inyecciones por Día' }) }).last();
  const ticks = injectionsCard.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value');
  await expect(ticks).toHaveCount(3);

  const bars = injectionsCard.locator('.recharts-bar-rectangle path');
  await expect(bars).toHaveCount(3);
  await expect(bars.first()).toBeVisible();
});
