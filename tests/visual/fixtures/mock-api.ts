import type { BrowserContext, Route } from '@playwright/test';
import {
  databaseTables,
  decryptedData,
  kubiosHrvResults,
  kubiosTeamUsers,
  syntheticCanonicalUsers,
  syntheticClientSession,
  syntheticUsers,
  unauthorizedProblem,
  usersCount,
} from './synthetic-data';

export interface NetworkEntry {
  kind: 'local-api' | 'supabase' | 'external' | 'auth';
  method: string;
  path: string;
  status?: number;
}

export interface CaptureState {
  localApi: NetworkEntry[];
  supabase: NetworkEntry[];
  external: NetworkEntry[];
  auth: NetworkEntry[];
  unmocked: NetworkEntry[];
  writeAttempts: NetworkEntry[];
}

const SUPABASE_HOST_SUFFIXES = ['.supabase.co', '.supabase.in'];

function isSupabaseHost(hostname: string) {
  return SUPABASE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function corsHeaders(extra: Record<string, string> = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-expose-headers': 'content-range,content-profile,x-client-info',
    'cache-control': 'no-store',
    ...extra,
  };
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    headers: corsHeaders({ 'content-type': 'application/json; charset=utf-8', ...extra }),
    body: JSON.stringify(body),
  });
}

async function fulfillEmpty(route: Route, status = 204) {
  await route.fulfill({ status, headers: corsHeaders() });
}

function apiFixture(
  pathname: string,
  url: URL,
  authenticated: boolean,
): { body: unknown; status?: number } | null {
  switch (pathname) {
    case '/api/auth/session':
      return authenticated
        ? { body: syntheticClientSession }
        : { body: unauthorizedProblem, status: 401 };
    case '/api/users/count':
      return { body: usersCount };
    case '/api/users': {
      const limit = Number(url.searchParams.get('limit') ?? syntheticCanonicalUsers.length);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const page = syntheticCanonicalUsers.slice(offset, offset + limit);
      return { body: { users: page, total: syntheticCanonicalUsers.length } };
    }
    case '/api/decrypted-data':
      return { body: decryptedData };
    case '/api/kubios/team-users':
      return { body: kubiosTeamUsers };
    case '/api/kubios/hrv-results':
    case '/api/kubios/hrv-results-fallback':
      return { body: kubiosHrvResults };
    case '/api/admin/database/tables':
      return { body: databaseTables };
    case '/api/admin/database/table-data':
      return { body: { success: true, tableName: 'users', data: syntheticUsers, totalRecords: syntheticUsers.length, returnedRecords: syntheticUsers.length, limit: 100 } };
    default:
      return null;
  }
}

function supabaseUsersForRequest(url: URL) {
  const usernameFilter = url.searchParams.get('Username') || url.searchParams.get('username');
  if (!usernameFilter) return syntheticUsers;
  const expected = usernameFilter.replace(/^eq\./, '');
  return syntheticUsers.filter((user) => user.Username === expected);
}

function wantsSingleObject(route: Route) {
  const accept = route.request().headers()['accept'] || '';
  return accept.includes('application/vnd.pgrst.object+json');
}

export async function installVisualMocks(
  context: BrowserContext,
  options: { authenticated: boolean },
): Promise<CaptureState> {
  const state: CaptureState = {
    localApi: [],
    supabase: [],
    external: [],
    auth: [],
    unmocked: [],
    writeAttempts: [],
  };

  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());

    if (isSupabaseHost(url.hostname)) {
      if (method === 'OPTIONS') {
        state.supabase.push({ kind: 'supabase', method, path: url.pathname, status: 204 });
        await fulfillEmpty(route);
        return;
      }

      if (url.pathname.startsWith('/auth/v1/user')) {
        state.auth.push({ kind: 'auth', method, path: url.pathname, status: 200 });
        await fulfillJson(route, {
          id: '00000000-0000-4000-8000-000000009001',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'qa.visual@example.invalid',
          email_confirmed_at: '2026-01-10T09:00:00.000Z',
          user_metadata: { username: 'demo_admin' },
          app_metadata: { provider: 'email', providers: ['email'] },
          created_at: '2026-01-10T09:00:00.000Z',
        });
        return;
      }

      if (url.pathname.startsWith('/auth/v1/logout')) {
        state.auth.push({ kind: 'auth', method, path: url.pathname, status: 204 });
        await fulfillEmpty(route, 204);
        return;
      }

      if (url.pathname.startsWith('/auth/v1/token')) {
        // The login forms are not submitted by the capture. Never allow a real auth call.
        state.auth.push({ kind: 'auth', method, path: url.pathname, status: 400 });
        await fulfillJson(route, { error: 'mock_auth_disabled', error_description: 'Visual tests never authenticate against Supabase' }, 400);
        return;
      }

      if (method !== 'GET' && method !== 'HEAD') {
        const entry = { kind: 'supabase' as const, method, path: url.pathname, status: 405 };
        state.supabase.push(entry);
        state.writeAttempts.push(entry);
        await fulfillJson(route, { message: 'write blocked by visual fixture' }, 405);
        return;
      }

      if (url.pathname === '/rest/v1/users') {
        const rows = supabaseUsersForRequest(url);
        const body = wantsSingleObject(route) ? (rows[0] ?? null) : rows;
        state.supabase.push({ kind: 'supabase', method, path: url.pathname, status: body === null ? 406 : 200 });
        await fulfillJson(
          route,
          body,
          body === null ? 406 : 200,
          {
            'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0',
            'content-profile': 'public',
          },
        );
        return;
      }

      if (url.pathname.startsWith('/rest/v1/')) {
        state.supabase.push({ kind: 'supabase', method, path: url.pathname, status: 200 });
        await fulfillJson(route, []);
        return;
      }

      state.supabase.push({ kind: 'supabase', method, path: url.pathname, status: 404 });
      await fulfillJson(route, { message: 'mock_not_found' }, 404);
      return;
    }

    const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (isLocal) {
      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }

      if (method !== 'GET' && method !== 'HEAD') {
        const entry = { kind: 'local-api' as const, method, path: url.pathname, status: 405 };
        state.localApi.push(entry);
        state.writeAttempts.push(entry);
        await fulfillJson(route, { error: 'write blocked by visual fixture' }, 405);
        return;
      }

      const fixture = apiFixture(url.pathname, url, options.authenticated);
      if (fixture) {
        state.localApi.push({ kind: 'local-api', method, path: url.pathname, status: fixture.status ?? 200 });
        await fulfillJson(route, fixture.body, fixture.status ?? 200);
        return;
      }

      const entry = { kind: 'local-api' as const, method, path: url.pathname, status: 501 };
      state.localApi.push(entry);
      state.unmocked.push(entry);
      await fulfillJson(route, { error: 'unmocked_visual_api', path: url.pathname }, 501);
      return;
    }

    const entry = { kind: 'external' as const, method, path: url.hostname + url.pathname, status: undefined };
    state.external.push(entry);
    await route.abort('blockedbyclient');
  });

  return state;
}
