import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract MT69: every chart expands into an overlay with its OWN scoped
 * filter. The scoped filter narrows only that chart, never the global filters
 * nor the sibling charts, and stays scoped to the chart after collapsing
 * (announced by the chip, clearable from the chip itself).
 * Runs only against an explicitly provided base URL with browser-mocked APIs.
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

/** Ticks de la evolución de insulina en la página (fuera del overlay). */
function inlineInsulinTicks(page: Page) {
  const card = page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Evolución de Registros de Insulina' }) }).last();
  return card.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value');
}

/** Ticks de la evolución de comidas en la página (fuera del overlay). */
function inlineMealTicks(page: Page) {
  const card = page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Evolución de Registros de Comidas' }) }).last();
  return card.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value');
}

test('el gráfico expandido aplica su filtro propio sin tocar el resto', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');

  const inlineTicks = inlineInsulinTicks(page);
  const mealTicks = inlineMealTicks(page);
  await expect(inlineTicks).toHaveCount(3);

  // Expandir: botón en la esquina de la tarjeta → dialog con el gráfico mayor.
  const card = page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Evolución de Registros de Insulina' }) }).last();
  await card.getByRole('button', { name: 'Expandir gráfico' }).click();
  const dialog = page.getByRole('dialog', { name: /Evolución de Registros de Insulina/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveCount(3);

  // Filtro propio de 7 días: las fechas del fixture quedan fuera → vacío.
  await dialog.getByRole('combobox', { name: 'Filtro propio del gráfico' }).selectOption('7');
  await expect(dialog.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveCount(0);

  // Aislamiento: el gráfico hermano no se entera mientras el overlay está abierto.
  await expect(mealTicks).toHaveCount(3);

  // Al quitar la expansión el filtro propio SE MANTIENE solo en ese gráfico,
  // anunciado por el chip y con la serie filtrada.
  await dialog.getByRole('button', { name: 'Cerrar vista expandida' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByText('Últimos 7 días')).toBeVisible();
  await expect(inlineTicks).toHaveCount(0);
  await expect(mealTicks).toHaveCount(3);

  // Quitar el filtro propio desde el chip devuelve la serie completa.
  await card.getByRole('button', { name: 'Quitar filtro propio' }).click();
  await expect(inlineTicks).toHaveCount(3);
  await expect(mealTicks).toHaveCount(3);
});

test('todos los gráficos analytics y overview ofrecen expandir', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');

  // 10 gráficos de analytics, cada uno con su botón de expandir.
  await expect(page.getByRole('button', { name: 'Expandir gráfico' })).toHaveCount(10);

  await page.goto('/overview');
  // El resumen general: pie por tipo + actividad por día.
  await expect(page.getByRole('button', { name: 'Expandir gráfico' })).toHaveCount(2);
});
