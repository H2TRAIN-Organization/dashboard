import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

const ROUTES = [
  'src/app/api/admin/kubios/participants/route.ts',
  'src/app/api/admin/kubios/measurements/route.ts',
]

const READER = 'src/lib/kubios-admin-reader.ts'
const GUARD = 'src/server/composition/kubios-admin-runtime.ts'

async function source(relativePath: string): Promise<string> {
  return readFile(join(ROOT, relativePath), 'utf8')
}

function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('AK-02 administrative Kubios API contract', () => {
  it('routes through the existing bridge and the real server admin guard', async () => {
    for (const route of ROUTES) {
      const text = await source(route)

      expect(text, route).toContain("export const runtime = 'nodejs'")
      expect(text, route).toContain("export const dynamic = 'force-dynamic'")
      expect(text, route).toContain('runApiRoute')
      expect(text, route).toContain('sessionTokenFrom(request)')
      expect(text, route).toContain('resolveKubiosAdminActor')
      expect(text, route).toContain('createKubiosRpcClient')
      expect(text, route).toContain('decryptKubiosSnapshot')

      const code = codeOnly(text)
      for (const forbidden of [
        'authorization',
        'Bearer',
        'NEXT_PUBLIC_',
        'getUser',
        'console.',
        'kubios-service',
      ]) {
        expect(code, `${route} no debe contener ${forbidden}`).not.toContain(
          forbidden,
        )
      }
    }
  })

  it('enforces the admin capability before any service client is created', async () => {
    const guard = await source(GUARD)
    expect(guard).toContain('canReadAdminDatabase')
    expect(guard).toContain('getServerRuntime')
    expect(guard).toContain('application.useCases.auth.getSession(token)')
    expect(guard).toContain('UnauthorizedError')
    expect(guard).toContain('ForbiddenError')

    const guardCheck = guard.indexOf('canReadAdminDatabase(actor)')
    expect(guardCheck).toBeGreaterThan(-1)
    expect(guard).toContain("import 'server-only'")
  })

  it('uses the confirmed service-only RPC names and bounded scan limits', async () => {
    const reader = await source(READER)

    expect(reader).toContain("import 'server-only'")
    expect(reader).toContain("'kubios_admin_list_participants'")
    expect(reader).toContain("'kubios_admin_list_snapshots'")
    expect(reader).toContain('p_after_user_id')
    expect(reader).toContain('p_start_user_id')
    expect(reader).toContain('p_user_id')
    expect(reader).toContain('p_limit')
    expect(reader).toContain('PARTICIPANTS_LIMIT = 100')
    expect(reader).toContain('SNAPSHOT_SCAN_LIMIT = 8')
    expect(reader).toContain('SNAPSHOT_REQUEST_LIMIT = SNAPSHOT_SCAN_LIMIT + 1')
    expect(reader).toContain('MEASUREMENT_LIMIT = 50')
  })

  it('reuses envelope validation, AES decryption and result timestamps', async () => {
    const reader = await source(READER)

    expect(reader).toContain('parseKubiosValidatedSnapshotRow')
    expect(reader).toContain('parseKubiosSnapshotPayload')
    expect(reader).toContain('readKubiosResultTimestamp')
    expect(reader).toContain('KUBIOS_SNAPSHOT_STALE_AFTER_MS')
    expect(reader).toContain('decryptSnapshot')
    expect(reader).toContain('canReadAdminDatabase')

    const code = codeOnly(reader)
    for (const forbidden of [
      'createClient',
      'process.env',
      'Authorization',
      'Bearer',
      'NEXT_PUBLIC_',
      'console.',
    ]) {
      expect(code, `reader no debe contener ${forbidden}`).not.toContain(
        forbidden,
      )
    }
  })

  it('keeps the response allowlist and never serializes raw payload fields', async () => {
    const reader = await source(READER)

    expect(reader).toContain('userId')
    expect(reader).toContain('username')
    expect(reader).toContain('measuredTimestamp')
    expect(reader).toContain('metrics')
    expect(reader).toContain('syncedAt')
    expect(reader).toContain('unavailableCount')
    expect(reader).toContain('nextCursor')
    expect(reader).toContain("'readiness'")
    expect(reader).toContain("'mean_hr_bpm'")
    expect(reader).toContain('result.freq_domain')
    expect(reader).toContain('Number.isFinite')

    const code = codeOnly(reader)
    for (const forbidden of [
      'result_id',
      'daily_result',
      'artefact_level',
      'ciphertext:',
      'nonce:',
      'tag:',
    ]) {
      expect(code, `reader no debe serializar ${forbidden}`).not.toContain(
        forbidden,
      )
    }
    expect(reader).not.toContain('translations')
  })
})
