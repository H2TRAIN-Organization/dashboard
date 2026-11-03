import { describe, expect, it, vi } from 'vitest'
import { Aes256CbcDecryptor } from '../../src/server/infrastructure/crypto/aes-256-cbc'
import { encryptRow, expectedBatch, matchesExpected, resolveTarget, runBatch, TARGET } from '../../scripts/seed-dashboard-dr.mjs'

describe('DR24–DR26 synthetic batch', () => {
  const key = 'ab'.repeat(32)
  const batch = expectedBatch('synthetic-participant') as unknown as Record<'fooddata' | 'exercisedata' | 'insulindata', Record<string, unknown>[]>
  it('reserves exactly 24 stable, distinct IDs across eight records per category', () => {
    const again = expectedBatch('synthetic-participant')
    expect(batch).toEqual(again)
    expect(Object.values(batch).map(rows => (rows as unknown[]).length)).toEqual([8, 8, 8])
    const rows = Object.values(batch).flat() as { id: number; username: string }[]
    expect(new Set(rows.map(row => row.id)).size).toBe(24)
    expect(rows.every(row => row.username === 'synthetic-participant' && Number.isSafeInteger(row.id))).toBe(true)
  })
  it('uses the existing decryptor format and never stores synthetic health text in plaintext', () => {
    const decryptor = new Aes256CbcDecryptor({ currentKeyHex: key, previousKeyHex: null })
    const sample = batch.fooddata[0]!
    const row = encryptRow('fooddata', sample, key)
    expect(decryptor.decryptText(row.food_type, row.food_type_iv, 'food_type')).toBe(sample.food_type)
    expect(decryptor.decryptText(row.carbs, row.carbs_iv, 'carbs')).toBe('0')
    expect(row.food_type).not.toBe(sample.food_type)
    expect(row.food_type.length).toBeLessThanOrEqual(50)
    expect(matchesExpected('fooddata', row, sample, key)).toBe(true)
  })
  it('refuses an ID collision, changed owner, date, or ciphertext before selective removal', () => {
    const sample = batch.exercisedata[0]!
    const row = encryptRow('exercisedata', sample, key)
    expect(matchesExpected('exercisedata', { ...row, username: 'someone-else' }, sample, key)).toBe(false)
    expect(matchesExpected('exercisedata', { ...row, date_time: '2026-10-01T00:00:00' }, sample, key)).toBe(false)
    expect(matchesExpected('exercisedata', { ...row, exercise_type: 'bad' }, sample, key)).toBe(false)
  })
})

describe('DR seed identity preflight', () => {
  type Identity = { id: string; email: string; email_confirmed_at: string | null; app_metadata: Record<string, unknown> }
  const identity: Identity = { id: 'auth-synthetic', email: TARGET, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} }
  function clientFor(identities: Identity[], username = TARGET) {
    const row = { UserID: 42, Username: username, UUID: null, role: 'user' }
    const from = vi.fn(() => ({ select: () => ({
      ilike: () => ({ limit: async () => ({ data: [row], error: null }) }),
      eq: (field: string) => ({ limit: async () => ({ data: field === 'UUID' ? [] : [row], error: null }) }),
    }) }))
    return { from, auth: { admin: { listUsers: async () => ({ data: { users: identities }, error: null }) } } }
  }
  it('rejects a missing Auth identity before any health-table operation', async () => {
    const client = clientFor([])
    await expect(runBatch(client, 'ab'.repeat(32), 'apply')).rejects.toThrow('No confirmed Auth identity')
    expect(client.from.mock.calls).toHaveLength(1)
  })
  it('requires confirmation even with an explicit application link', async () => {
    const client = clientFor([{ ...identity, email_confirmed_at: null, app_metadata: { app_user_id: '42' } }])
    await expect(runBatch(client, 'ab'.repeat(32), 'apply')).rejects.toThrow('No confirmed Auth identity')
    expect(client.from.mock.calls).toHaveLength(1)
  })
  it('rejects a nearly matching Username rather than accepting an ilike candidate', async () => {
    await expect(resolveTarget(clientFor([identity], 'jiahaoXyang@ulpgc.es'))).rejects.toThrow('No confirmed unique application account')
  })
  it('reports confirmation only after checking the exact confirmed identity', async () => {
    const result = await resolveTarget(clientFor([identity]))
    expect(result.accountConfirmed).toBe(true)
    expect(result.target.UserID).toBe(42)
  })
})
