# Acceptance tests (T-010)

These tests target the **final cookie contract**:

- `POST /api/auth/login` with `{email,password}` or `{username,password}` returns
  `{user, method, expiresAt}` and sets an HttpOnly cookie. It must not return a
  JSON token.
- `GET /api/auth/session` reads that cookie. Bearer-only access must fail.
- `POST /api/auth/logout` returns `204` and invalidates the cookie.
- User DTO fields: `id, username, email, role, uuid, gdprConsent, gdprConsentAt, createdAt`.
- `GET /api/users` returns `{users,total}`.
- `admin` has full CRUD; `doctor` is global read-only; `user` is self-only.
- Deleting a user with health data returns `409` / `USER_HAS_DATA`.
- Mutations must carry same-origin CSRF headers (`Origin` or
  `Sec-Fetch-Site: same-origin`), matching the foundation route bridge.
- `dateFilter` is `YYYY-MM-DD`, covers the selected UTC calendar day
  `[00:00, next 00:00)`, and intersects `timeRange`; it must not behave as
  "start date until now".

The current foundation working tree has the cookie adapter in
`src/server/http/handlers/auth.ts`, `cookies.ts`, and the `/api/auth/*` routes;
the OpenAPI now uses `cookieAuth` and no token in the public session. These tests
target that final shape. The earlier Bearer snapshot is stale and is not used as
current state. Integration (runtime registration, auth/persistence wiring) is
still required before the suite can run against a mounted backend.

## Dependencies

- Node.js 24+ (built-in `node:test` and `fetch`; no npm install, no root edits).
- A disposable local backend on `ACCEPTANCE_BASE_URL`, already mounted.
- A seeded admin account and one seeded user with health data (for the 409 case).

No test contacts a real database or production service. The suite only calls
the dashboard HTTP API; it never writes to Supabase directly.

Integration status is still incomplete: `src/server/composition/runtime.ts` has
no registered factory, so routes fail closed with `503` until the integrator
wires auth + persistence. Auth also requires an injected bcrypt library and
`AUTH_SESSION_SECRET`; persistence requires the T-009 SQL migrations.

## Run

```powershell
$env:ACCEPTANCE_BASE_URL = 'http://127.0.0.1:3000'
node --test tests/acceptance/api.test.mjs
```

Optional overrides:

```text
ACCEPTANCE_ADMIN_EMAIL       default admin.acceptance@example.test
ACCEPTANCE_ADMIN_PASSWORD    default Acceptance-Admin-1!
ACCEPTANCE_HAS_DATA_USERNAME default acceptance.hasdata
```

The admin account must exist in the disposable backend. Doctor and user accounts
are created through `POST /api/users` with unique synthetic names. Seed
`acceptance.bcrypt` with a disposable bcrypt cost-10 hash and rows on adjacent
days to exercise the calendar-day filter. The 409 and day-filter tests skip with
an explicit message if their seeds are absent; a skip is not a pass.

## Portability

- Run from the integrated repository root; the launcher defaults `AppRoot` to
  its own repository root. Override only when testing another checkout:
  `-AppRoot (Resolve-Path .).Path`.
- Playwright specs import `@playwright/test` as a package; configs derive
  `testDir` from their own location. No host absolute paths or sibling
  worktrees are required.
- The Supabase SDK smoke resolves `@supabase/supabase-js` from its own package
  graph through `createRequire(import.meta.url)`.
- Premerge validation trees may temporarily junction the integrated root
  `node_modules` when packages are absent. The junction is not versioned and is
  removed before final evidence; final tests use the merged package graph.
- The T-065 harness is frozen for integration: final execution must run from the
  merged repository root, not a hardcoded validation worktree.
- **T-065 static FREEZE.** Browser execution remains pending the T-066 calendar
  fix and a new integrated build. No 10/10 mock PASS is claimed yet. Node and
  Postman remain frozen; release remains blocked until the functional target
  and full mock rerun.

## Postman

`postman/` is independent of the Node suite:

- `postman/collections/acceptance-api/` — cookie-auth flow, no bearer requests.
- `postman/environments/acceptance-local.environment.yaml` — synthetic values.
- `postman/mocks/supabase/` — local Supabase REST/Auth stand-in with synthetic
  users, `auth_sessions`, `auth_login_consume/reset`, `t009_*` RPCs, and health
  rows. It is a dependency stand-in, **not** a mock of the dashboard under test.
  The seeded bcrypt hash is a disposable synthetic fixture; no real hash is used.
- `postman/simulations/supabase-local.sim.yaml` — one local simulation.

Start the dependency simulation (not the dashboard):

```powershell
postman simulation run postman/simulations/supabase-local.sim.yaml --port 4900 --output ndjson
```

Point the real backend at `http://127.0.0.1:4900/supabase` via
`SUPABASE_URL`, and use the synthetic publishable key from the environment file.
The backend must still be mounted by the integrator. No simulation deploy,
workspace push, or public mock is performed.

After the integrator mounts the backend:

```powershell
postman collection run postman/collections/acceptance-api -e postman/environments/acceptance-local.environment.yaml
```

## Cookie-jar portability (V3)

Postman's automatic jar otherwise replaces the explicit actor cookie with the
last login. The V3 field is `settings.disableCookies: true` on each request.
This was verified, not assumed: a minimal v2.1 request with
`protocolProfileBehavior.disableCookies: true` was migrated with
`postman collection migrate`, and the generated V3 request contained
`settings: { disableCookies: true }`. V3 `disabledSystemHeaders` does not accept
`cookie`; `protocolProfileBehavior` is not the V3 form.

## T-037 execution (PASS, frozen)

The launcher starts the Postman Supabase dependency stand-in on 4900 and the
real integrated Next backend on 4630 with **synthetic** environment values,
waits for readiness, resets the stand-in between suites, runs Node, Postman and
the real-browser Playwright suite, and always stops its own process tree.

```powershell
.\tests\acceptance\t037-launcher.ps1 -RunTests -RunPlaywright `
  -AppRoot (Resolve-Path .).Path
```

Observed evidence:

- Node: **15/15 PASS**, 0 fail, 0 skipped (strict seeds).
- Postman: **22/22 requests**, 48/48 assertions, 0 test-script failures.
- Playwright backend-real: **2/2 PASS** (email and username login, cookie
  reload, logout, Users CRUD); only `/api/kubios/**` and external hosts are
  intercepted, never `/api/auth/**` or `/api/users/**`.
- Backend API/server bytes: root `c819139`; identical API/server content to
  `77944c4` (runtime merge `159560c`). Stand-in is not a real Supabase claim.
- Ports 4900/4630/4910 closed after teardown; no SQL remote, no `.env`, no
  real credentials. The launcher uses a synthetic service-role JWT and an
  intentionally invalid synthetic anon `SUPABASE_SECRET_KEY`.

`ACCEPTANCE_STRICT_SEEDS=1` converts missing seeded fixtures into failures, so
T-037 reports **15/15 API and 22/22 Postman with no skips**. The T-037 Node
evidence and `postman/` remain frozen; T-057 adds browser checks only. Node and
Postman are not repeated while the API/server byte SHA remains unchanged.

## T-057 final browser execution (BUG, no freeze)

Executed against root `c9f6ef2f09d6829bcc12807d2864a5718b57b58f` using the
existing final production build. The same launcher starts the synthetic
Supabase stand-in on 4900 and Next on 4630; the final browser rerun does **not**
repeat Node/Postman:

```powershell
.\tests\acceptance\t037-launcher.ps1 -RunPlaywright -RunMockPlaywright `
  -AppRoot (Resolve-Path .).Path
```

Do not add `-RunTests`; Node and Postman evidence is frozen. The launcher also
accepts `-SkipNode`/`-SkipPostman` for guarded T-037-compatible runs. On the
T-057 host an existing Root dev process on 3000 held the Next dev lock, so the
run used `-UseBuild` to serve the c9f6 production build on 4630:

- Backend-real: the original **2** tests in `frontend-real.spec.mjs`; auth and
  users still hit the real Root API. Only `/api/kubios/**` and non-local hosts
  are intercepted.
- Frontend mock: `frontend.spec.mjs` now runs against the **same Root 4630**
  server, with every `/api/**` request mocked per test. The API mock is
  synthetic and isolated from backend-real evidence; `externalRequests` must
  remain empty.
- The existing 7 mock tests are retained. Three functional regression checks
  were added for the T-046/T-047/T-048 refactors:
  1. Data calendar: desktop 1440x1000, mobile 375x812, and resize/orientation
     667x375 -> 667x667; assert popup bounding boxes stay inside the viewport,
     mobile popup flips above a bottom-edge trigger, select a day with a real
     click, verify the selected user/type/time filters reach
     `/api/decrypted-data`, then clear all filters. Still one test (suite 10).
  2. Language: ES/EN toggle persists across reload while protected loading
     remains behind the session guard (content is not rendered early).
  3. Blocked `localStorage`: language still falls back in memory without an
     uncaught page error.
- The final visual run remains separate on the detached 4611 snapshot; it does
  not touch this launcher or the Root server.

### Result

- Backend-real: **2/2 PASS** (both logins, cookie reload, Users CRUD, logout).
  Not repeated after this because API/session context did not change.
- Frontend mock existing tests: **7/7 PASS** inside the full run.
- Language + blocked-storage focused run: **2/2 PASS** (ES/EN reload
  persistence, guarded loading, no throw with blocked storage).
- Data calendar: **FAIL — product defect, not a relaxed-assertion failure**.
  The harness selector was corrected from `div.fixed.inset-0` to the actual
  portal class `div.fixed`; after that the overlay opened and the product
  positioning bug surfaced. Failed action: `calendar.locator('button').nth(1).click()` at
  `frontend.spec.mjs:221`. Playwright repeatedly reported the resolved
  next-month button as `visible`, `enabled`, `stable`, but `element is outside
  of the viewport`; viewport was 1440x1000. A bounding box and scroll offset
  were not captured.
  Root cause confirmed preexisting at `2bba6e0`: `src/app/data/page.tsx`
  computes `top: rect.bottom + window.scrollY + 8` and
  `left: rect.left + window.scrollX` while rendering the calendar overlay with
  `position: fixed` (`src/app/data/page.tsx:345` and `:156`), without viewport
  clamping. T-047 extraction preserved the preexisting bug.
- The full 10-test mock run therefore stopped at 7 passed / 1 failed /
  2 did not run; the two skipped-in-serial language/storage tests were then run
  independently and passed. No test was force-clicked and no source was edited.
- T-057 is **not frozen**. Author fix belongs in a new worktree with minimal
  overlay-position change (preserve CSS/layout). After integration, a new build
  is required for `-UseBuild`, and the integrator must stop the existing Root
  dev server on 3000 before a dev-mode rerun. Target retest is calendar-only
  first, then the full 10 mock; real tests do not need repeating unless API or
  session context changes.

## Evidence boundary

Backend was real and mounted; Supabase was the local Postman dependency stand-in,
not a real Supabase project. No SQL/DB migration, deploy, workspace push, or
production data was used. Earlier frontend-mock Playwright evidence remains
separate from this backend-real run.
