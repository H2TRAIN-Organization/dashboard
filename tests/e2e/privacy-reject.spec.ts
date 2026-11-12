import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract MT37: the privacy policy view offers a red reject button with a
 * formal confirmation modal; confirming records the rejection and redirects
 * to the login screen. Runs only against an explicitly provided base URL with
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

async function mockPrivacyPage(page: Page, decision: { status: number }) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: SESSION });
    if (path === '/api/privacy/decision') {
      const body = route.request().postDataJSON() as { decision?: string };
      expect(body.decision).toBe('reject');
      return route.fulfill({ status: decision.status, json: { rejected: true } });
    }
    return route.fulfill({ json: {} });
  });
}

test('the red reject button opens a formal confirmation modal', async ({ page }) => {
  await mockPrivacyPage(page, { status: 200 });
  await page.goto('/privacy');

  const rejectButton = page.getByRole('button', { name: /Rechazar la pol/i });
  await expect(rejectButton).toBeVisible();
  await expect(rejectButton).toHaveClass(/bg-red-600/);

  await rejectButton.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('heading', { name: /Confirma el rechazo/ })).toBeVisible();
  await expect(modal.getByText(/pantalla de inicio de sesi/i)).toBeVisible();

  // Cancel keeps the user on the policy page.
  await modal.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rejectButton).toBeVisible();
});

test('confirming the rejection signs out and redirects to the login', async ({ page }) => {
  await mockPrivacyPage(page, { status: 200 });
  await page.goto('/privacy');

  await page.getByRole('button', { name: /Rechazar la pol/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /rechazar y cerrar sesi/i }).click();

  await expect(page).toHaveURL(/\/login$/);
});

test('a failed rejection keeps the modal open with the conflict message', async ({ page }) => {
  await mockPrivacyPage(page, { status: 409 });
  await page.goto('/privacy');

  await page.getByRole('button', { name: /Rechazar la pol/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /rechazar y cerrar sesi/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/conflicto del servidor/i)).toBeVisible();
});
