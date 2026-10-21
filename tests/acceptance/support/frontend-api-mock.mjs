/**
 * Per-test synthetic API for the frontend mock suite only. It never replaces
 * the backend-real suite and records external attempts for the test teardown.
 */
const COOKIE = 'dashboard_session';

function json(route, status, body, headers = {}) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: body === undefined ? '' : JSON.stringify(body),
  });
}

function problem(route, status, code, message) {
  return json(route, status, { error: { code, message } });
}

function cookieToken(request) {
  const header = request.headers()['cookie'] ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

function sessionCookie(token, maxAge = 3600) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function installFrontendApiMock(page, options = {}) {
  const users = [
    {
      id: '1', username: 'admin.demo', email: 'admin.demo@example.test', role: 'admin',
      uuid: 'uuid-admin', gdprConsent: true, gdprConsentAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: '2', username: 'doctor.demo', email: null, role: 'doctor',
      uuid: 'uuid-doctor', gdprConsent: true, gdprConsentAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: '3', username: 'user.demo', email: null, role: 'user',
      uuid: 'uuid-user', gdprConsent: false, gdprConsentAt: null,
      createdAt: '2026-01-03T00:00:00.000Z',
    },
    {
      id: '4', username: 'has.data', email: null, role: 'user',
      uuid: 'uuid-has-data', gdprConsent: true, gdprConsentAt: '2026-01-04T00:00:00.000Z',
      createdAt: '2026-01-04T00:00:00.000Z',
    },
  ];
  const passwords = {
    'admin.demo@example.test': { password: 'demo', id: '1', method: 'email' },
    'doctor.demo': { password: 'demo', id: '2', method: 'username' },
    'user.demo': { password: 'demo', id: '3', method: 'username' },
    'has.data': { password: 'demo', id: '4', method: 'username' },
  };
  const sessions = new Map();
  const externalRequests = [];
  const dataRequests = [];
  let listDelay = options.listDelay ?? 0;
  let sessionDelay = options.sessionDelay ?? 0;
  let requestCount = 0;

  function sessionUser(request) {
    const token = cookieToken(request);
    const id = token === null ? null : sessions.get(token);
    return id === null ? null : users.find((user) => user.id === id) ?? null;
  }

  function sessionBody(user, method) {
    return { user, method, expiresAt: '2099-01-01T00:00:00.000Z' };
  }

  async function handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    requestCount += 1;

    if (path === '/api/auth/session' && method === 'GET') {
      if (sessionDelay > 0) await new Promise((resolve) => setTimeout(resolve, sessionDelay));
      const user = sessionUser(request);
      if (!user) return problem(route, 401, 'UNAUTHORIZED', 'Autenticación requerida');
      return json(route, 200, sessionBody(user, user.id === '1' ? 'email' : 'username'));
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const body = request.postDataJSON();
      const identifier = body.email ?? body.username;
      const account = passwords[identifier];
      if (!account || body.password !== account.password) {
        return problem(route, 401, 'UNAUTHORIZED', 'Credenciales inválidas');
      }
      const user = users.find((entry) => entry.id === account.id);
      const token = `mock-${account.id}-${requestCount}`;
      sessions.set(token, account.id);
      return json(route, 200, sessionBody(user, account.method), {
        'set-cookie': sessionCookie(token),
      });
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const token = cookieToken(request);
      if (token) sessions.delete(token);
      return route.fulfill({
        status: 204,
        headers: { 'set-cookie': sessionCookie('', 0) },
        body: '',
      });
    }

    const user = sessionUser(request);
    if (!user) return problem(route, 401, 'UNAUTHORIZED', 'Autenticación requerida');

    if (path === '/api/users' && method === 'GET') {
      if (listDelay > 0) await new Promise((resolve) => setTimeout(resolve, listDelay));
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const role = url.searchParams.get('role');
      let visible = user.role === 'user' ? [user] : users;
      if (search) visible = visible.filter((entry) => entry.username.toLowerCase().includes(search));
      if (role) visible = visible.filter((entry) => entry.role === role);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      return json(route, 200, { users: visible.slice(offset, offset + limit), total: visible.length });
    }

    if (path === '/api/users' && method === 'POST') {
      if (user.role !== 'admin') return problem(route, 403, 'FORBIDDEN', 'Solo administrador');
      const body = request.postDataJSON();
      if (users.some((entry) => entry.username === body.username)) {
        return problem(route, 409, 'CONFLICT', 'El nombre de usuario ya existe');
      }
      const created = {
        id: String(Math.max(...users.map((entry) => Number(entry.id))) + 1),
        username: body.username,
        email: null,
        role: body.role ?? 'user',
        uuid: null,
        gdprConsent: Boolean(body.gdprConsent),
        gdprConsentAt: body.gdprConsent ? '2026-01-05T00:00:00.000Z' : null,
        createdAt: '2026-01-05T00:00:00.000Z',
      };
      users.push(created);
      return json(route, 201, { user: created });
    }

    const userPath = path.match(/^\/api\/users\/([^/]+)(\/uuid)?$/);
    if (userPath) {
      const id = decodeURIComponent(userPath[1]);
      const target = users.find((entry) => entry.id === id);
      if (user.role !== 'admin') return problem(route, 403, 'FORBIDDEN', 'Solo administrador');
      if (!target) return problem(route, 404, 'NOT_FOUND', 'Usuario no encontrado');
      if (userPath[2] && method === 'DELETE') {
        target.uuid = null;
        return json(route, 200, { user: target });
      }
      if (method === 'PATCH') {
        const body = request.postDataJSON();
        if (body.username !== undefined) target.username = body.username;
        if (body.role !== undefined) target.role = body.role;
        if (body.gdprConsent !== undefined) {
          target.gdprConsent = body.gdprConsent;
          target.gdprConsentAt = body.gdprConsent ? '2026-01-06T00:00:00.000Z' : null;
        }
        return json(route, 200, { user: target });
      }
      if (method === 'DELETE') {
        if (target.id === '4') {
          return problem(route, 409, 'USER_HAS_DATA', 'No se puede eliminar un usuario con datos');
        }
        const index = users.indexOf(target);
        users.splice(index, 1);
        return route.fulfill({ status: 204, body: '' });
      }
    }

    if (path === '/api/users/count' && method === 'GET') {
      return json(route, 200, { count: user.role === 'user' ? 1 : users.length });
    }

    if (path === '/api/decrypted-data' && method === 'GET') {
      dataRequests.push({
        selectedUser: url.searchParams.get('selectedUser'),
        timeRange: url.searchParams.get('timeRange'),
        selectedDataType: url.searchParams.get('selectedDataType'),
        dateFilter: url.searchParams.get('dateFilter'),
      });
      if (user.role === 'user' && url.searchParams.get('selectedUser') === 'all') {
        return problem(route, 403, 'FORBIDDEN', 'Solo datos propios');
      }
      return json(route, 200, {
        insulinData: [], foodData: [], exerciseData: [], periodData: [], moodData: [],
      });
    }

    if (path === '/api/kubios/team-users' && method === 'GET') {
      return json(route, 200, { users: [{ user_id: 'synthetic-1', name: 'Synthetic' }] });
    }

    if (path === '/api/admin/database/tables' && method === 'GET') {
      if (user.role !== 'admin') return problem(route, 403, 'FORBIDDEN', 'Solo administrador');
      return json(route, 200, {
        success: true,
        tables: [{ name: 'users', recordCount: users.length, accessible: true }],
        totalRecords: users.length,
        accessibleCount: 1,
        totalCount: 1,
      });
    }

    if (path === '/api/admin/database/table-data' && method === 'GET') {
      if (user.role !== 'admin') return problem(route, 403, 'FORBIDDEN', 'Solo administrador');
      return json(route, 200, {
        success: true, tableName: 'users', data: users, totalRecords: users.length,
        returnedRecords: users.length, limit: 100,
      });
    }

    return problem(route, 404, 'NOT_FOUND', `Endpoint no modelado: ${method} ${path}`);
  }

  page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      externalRequests.push(url.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });
  page.route('**/api/**', handle);

  return {
    users,
    externalRequests,
    dataRequests,
    setListDelay(value) { listDelay = value; },
    setSessionDelay(value) { sessionDelay = value; },
  };
}

export async function waitForHydration(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

export async function loginEmail(page) {
  await page.goto('/login');
  await waitForHydration(page);
  await page.locator('#email').fill('admin.demo@example.test');
  await page.locator('#password').fill('demo');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/');
}

export async function loginUsername(page, username) {
  await page.goto('/app-login');
  await waitForHydration(page);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill('demo');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/app-dashboard');
}
