import type { BrowserContext } from '@playwright/test';

export type AuthMode = 'none' | 'supabase' | 'app' | 'both';

export interface PageDefinition {
  id: string;
  label: string;
  path: string;
  auth: AuthMode;
  ready: string;
  rendered: boolean;
}

/**
 * Pages covered by this suite. Baseline runs against its own lockfile
 * (Next 15.4.6 / React 19.1 / Supabase 2.54), so login pages are rendered.
 * Static JSX evidence is still captured separately for both login pages.
 */
export const PAGE_DEFINITIONS: PageDefinition[] = [
  { id: 'login', label: 'Login (legacy Supabase)', path: '/login', auth: 'none', ready: 'form', rendered: true },
  { id: 'app-login', label: 'Login (app username)', path: '/app-login', auth: 'none', ready: 'form', rendered: true },
  { id: 'home', label: 'Home dashboard', path: '/', auth: 'both', ready: 'h1', rendered: true },
  { id: 'users', label: 'Users', path: '/users', auth: 'both', ready: 'h1', rendered: true },
  { id: 'data', label: 'Data', path: '/data', auth: 'both', ready: 'input[placeholder="Buscar en datos..."]', rendered: true },
  { id: 'analytics', label: 'Analytics', path: '/analytics', auth: 'both', ready: '.recharts-responsive-container', rendered: true },
  { id: 'overview', label: 'Overview', path: '/overview', auth: 'both', ready: '.recharts-responsive-container', rendered: true },
  { id: 'admin', label: 'Admin', path: '/admin', auth: 'both', ready: 'h1', rendered: true },
  { id: 'database', label: 'Admin database', path: '/admin/database', auth: 'both', ready: 'h1', rendered: true },
];

export const AUTH_STORAGE_KEY = 'sb-byzrronowbnffarazhps-auth-token';

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function syntheticSession() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = 4102444800; // 2100-01-01
  const accessToken = [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({
      sub: '00000000-0000-4000-8000-000000009001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'qa.visual@example.invalid',
      iat: nowSeconds,
      exp,
    }),
    'synthetic-visual-signature-not-a-secret',
  ].join('.');

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'synthetic-visual-refresh-token',
    user: {
      id: '00000000-0000-4000-8000-000000009001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'qa.visual@example.invalid',
      email_confirmed_at: '2026-01-10T09:00:00.000Z',
      phone: '',
      confirmed_at: '2026-01-10T09:00:00.000Z',
      last_sign_in_at: '2026-10-20T10:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { username: 'demo_admin' },
      identities: [],
      created_at: '2026-01-10T09:00:00.000Z',
      updated_at: '2026-10-20T10:00:00.000Z',
      is_anonymous: false,
    },
  };
}

export const syntheticAppUser = {
  UserID: 9001,
  Username: 'demo_admin',
  role: 'admin',
};

/**
 * Seeds a fictitious client-side session only for legacy protected pages.
 * This does NOT validate login, does NOT exercise Supabase, and is documented
 * as a visual fixture limitation. Login pages are captured without a session.
 */
export async function seedBrowserStorage(context: BrowserContext, auth: AuthMode) {
  const session = syntheticSession();
  await context.addInitScript(
    ({ mode, sessionValue, appUser, language, storageKey }) => {
      try {
        // Deterministic synthetic randomness (e.g. home accuracy badge) without freezing Date/Timers.
        let seed = 0x5eed1234;
        Math.random = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 0x100000000;
        };
        localStorage.setItem('language', language);
        if (mode === 'supabase' || mode === 'both') {
          localStorage.setItem(storageKey, JSON.stringify(sessionValue));
        }
        if (mode === 'app' || mode === 'both') {
          localStorage.setItem('app_user', JSON.stringify(appUser));
        }
      } catch {
        // Storage is unavailable on about:blank; the script runs again on the page origin.
      }
    },
    {
      mode: auth,
      sessionValue: session,
      appUser: syntheticAppUser,
      language: 'es',
      storageKey: AUTH_STORAGE_KEY,
    },
  );
}
