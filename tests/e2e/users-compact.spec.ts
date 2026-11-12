import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract MT36: the user management view keeps every piece of information
 * (user, UUID, status, GDPR, role, actions) in a compact, dense layout.
 * Runs only against an explicitly provided base URL with browser-mocked APIs.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const USERS = [
  {
    UserID: '1',
    Username: 'participant-one',
    Email: null,
    UUID: 'uuid-1111',
    GDPRConsent: true,
    GDPRConsentDate: null,
    role: 'user',
    createdAt: null,
  },
  {
    UserID: '2',
    Username: 'participant-two',
    Email: null,
    UUID: null,
    GDPRConsent: false,
    GDPRConsentDate: null,
    role: 'doctor',
    createdAt: null,
  },
];

const SESSION = {
  user: { id: '9', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
  method: 'username' as const,
  expiresAt: '2030-01-01T00:00:00Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
};

async function mockUsers(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: SESSION });
    if (path.startsWith('/api/users')) {
      return route.fulfill({ json: { users: USERS, total: USERS.length } });
    }
    return route.fulfill({ json: {} });
  });
}

test('the compact table keeps every user field and action', async ({ page }) => {
  await mockUsers(page);
  await page.goto('/users');

  // Compact header with the total and the create action.
  await expect(page.getByText('Total: 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear usuario' })).toBeVisible();

  // Every column of information is still present, now including the role.
  for (const header of ['Usuario', 'UUID', 'Estado', 'Rol', 'Acciones']) {
    await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
  }

  // Per-row information: UUID, GDPR badge, role selector and actions. The
  // assertions target the desktop table because the mobile cards duplicate
  // the same data in the DOM.
  const table = page.getByRole('table');
  await expect(table.getByText('uuid-1111')).toBeVisible();
  await expect(table.getByText('Sin UUID asignado')).toBeVisible();
  await expect(table.getByText('GDPR: Sí')).toBeVisible();
  await expect(table.getByText('GDPR: No')).toBeVisible();
  // The desktop table keeps its own role selector and actions per row.
  await expect(table.getByRole('combobox', { name: 'Rol', exact: true })).toHaveCount(2);
  await expect(table.getByRole('button', { name: 'Eliminar' })).toHaveCount(2);
});
