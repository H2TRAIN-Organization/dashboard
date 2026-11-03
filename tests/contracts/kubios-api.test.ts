import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { KUBIOS_CSV_HEADERS, buildKubiosCsv } from '@/lib/kubios-csv'

const ROOT = process.cwd()

async function source(relativePath: string): Promise<string> {
  return readFile(join(ROOT, relativePath), 'utf8')
}

/** Ignora comentarios al buscar palabras prohibidas (pueden documentarse). */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const KUBIOS_ROUTES = [
  'src/app/api/kubios/me/route.ts',
  'src/app/api/kubios/hrv-results/route.ts',
  'src/app/api/kubios/export/route.ts'
]

const FORBIDDEN_IN_READ_ROUTES = [
  'authorization',
  'Authorization',
  'Bearer',
  'getUser',
  'NEXT_PUBLIC_',
  'kubios-service',
  'new KubiosService',
  'analysis.kubioscloud',
  'console.'
]

describe('K50 Kubios API contract', () => {
  it('reads identity only from the HttpOnly session cookie', async () => {
    for (const route of KUBIOS_ROUTES) {
      const text = await source(route)

      expect(text, route).toContain("export const runtime = 'nodejs'")
      expect(text, route).toContain("export const dynamic = 'force-dynamic'")
      expect(text, route).toContain('sessionTokenFrom(request)')
      expect(text, route).toContain('resolveKubiosRequestIdentity')
      expect(text, route).toContain('createKubiosRpcClient')
      expect(text, route).toContain('decryptKubiosSnapshot')

      const code = codeOnly(text)
      for (const forbidden of FORBIDDEN_IN_READ_ROUTES) {
        expect(code, `${route} no debe contener ${forbidden}`).not.toContain(forbidden)
      }
    }

    const me = await source('src/app/api/kubios/me/route.ts')
    expect(me).not.toContain('searchParams')

    const hrv = await source('src/app/api/kubios/hrv-results/route.ts')
    expect(hrv).toContain('url: request.url')
  })

  it('keeps identity resolution injected, integer-based and fail-closed', async () => {
    const text = await source('src/lib/kubios-authz.ts')
    const code = codeOnly(text)

    expect(text).toContain('getSession')
    expect(text).toContain('kubios_get_user_member_link')
    expect(text).toContain('p_user_id')
    expect(text).toContain('Number.isSafeInteger')
    expect(text).toContain('CANONICAL_INTEGER_PATTERN')
    expect(text).toContain('createService')
    expect(code).not.toContain('getUser')
    expect(code).not.toContain('Bearer')
    expect(code).not.toContain('createClient')
    expect(code).not.toContain('process.env')
    expect(code).not.toContain('NEXT_PUBLIC_')
  })

  it('uses a lazy private service client pinned to the public schema', async () => {
    const text = await source('src/server/composition/kubios-runtime.ts')
    const code = codeOnly(text)

    expect(text).toContain('getServerRuntime')
    expect(text).toContain('application.useCases.auth.getSession(token)')
    expect(text).toContain('SUPABASE_URL')
    expect(text).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(text).toContain('assertServiceRoleKey')
    expect(text).toContain("db: { schema: 'public' }")
    expect(code).not.toContain('NEXT_PUBLIC_')
    expect(code).not.toContain('https://')
  })

  it('retires the old listing and fallback routes with a fixed 410', async () => {
    const retired = [
      'src/app/api/kubios/team-users/route.ts',
      'src/app/api/kubios/hrv-results-fallback/route.ts'
    ]
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    const expected = { error: 'gone', message: 'Endpoint deshabilitado' }
    const modules = [
      await import('@/app/api/kubios/team-users/route'),
      await import('@/app/api/kubios/hrv-results-fallback/route')
    ] as unknown as Record<string, (() => Promise<Response>) | undefined>[]

    for (const [index, relativePath] of retired.entries()) {
      const text = await source(relativePath)
      expect(text).toContain('status: 410')
      expect(text).not.toContain('KubiosService')
      expect(text).not.toContain('MOCK_')
      expect(text).not.toContain('fetch(')
      expect(text).not.toContain('process.env')
      expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)

      const route = modules[index]
      if (route === undefined) throw new Error('missing retired route module')
      for (const method of methods) {
        expect(typeof route[method], `${relativePath} ${method}`).toBe('function')
        const response = await route[method]?.()
        if (response === undefined) throw new Error('missing response')
        expect(response.status).toBe(410)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual(expected)
      }
      expect(route.HEAD).toBeUndefined()
      expect(route.OPTIONS).toBeUndefined()
    }
  })

  it('exports only the fixed own-data CSV columns and neutralizes formulas', () => {
    const csv = buildKubiosCsv([
      {
        measured_timestamp: '2026-11-02T10:00:00.000Z',
        daily_result: ' =SUM(A1)',
        result: {
          readiness: 80,
          mean_hr_bpm: 62,
          rmssd_ms: 42.5,
          pns_index: 75,
          sns_index: 25,
          physiological_age: 35,
          respiratory_rate: 14,
          stress_index: 30,
          artefact_level: '@cmd',
          freq_domain: {
            HF_power: 1.5,
            LF_power: 2.5,
            VLF_power: 3.5,
            tot_power: 7.5
          }
        }
      }
    ])

    const [header, row] = csv.split('\r\n')
    expect(header).toBe(KUBIOS_CSV_HEADERS.join(','))
    expect(row).toContain("' =SUM(A1)")
    expect(row).toContain("'@cmd")
    expect(row).toContain('80,62,42.5')
    expect(csv).not.toContain('result_id')
    expect(csv).not.toContain('measure_id')
    expect(csv).not.toContain('user_id')
    expect(csv).not.toContain('user_name')
    expect(csv).not.toContain('email')
  })
})
