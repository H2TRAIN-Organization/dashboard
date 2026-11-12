import { writeFile, mkdir } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { expect, it } from 'vitest'
import { createPostgrestGateway } from '@/server/infrastructure/persistence/supabase/postgrest-gateway'
import { SupabaseHealthDataRepository } from '@/server/infrastructure/persistence/health/health-data-repository'
import { Aes256CbcDecryptor, readEncryptionKeyConfig } from '@/server/infrastructure/crypto'
import { buildHealthCsvDocument } from '@/lib/health-csv'
import type { DecryptedDataResponse } from '@/lib/api-types'
import { TARGET } from '../../scripts/seed-dashboard-dr.mjs'

function liveRepository() {
  process.loadEnvFile('.env.local')
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return new SupabaseHealthDataRepository(
    createPostgrestGateway(client),
    new Aes256CbcDecryptor(readEncryptionKeyConfig()),
  )
}

// Explicitly opted-in, read-only verification. Normal test runs never contact
// the real database, load its credentials, or insert/modify any record.
it.skipIf(process.env.DR_VERIFY_LIVE_SEED !== '1')('reads and decrypts the 24 confirmed batch rows through the production repository and exports the common CSV', async () => {
  // NODE_ENV=test deliberately makes Next skip .env.local. Only this explicit
  // opt-in reads the local server environment; values are never logged.
  const repository = liveRepository()
  const data = await repository.getDecryptedData({ selectedUser: TARGET, selectedDataType: 'all', timeRange: 'all', dateFilter: '2026-11-03', dateFrom: null, dateTo: null, from: '2026-11-03T00:00:00.000Z', to: '2026-11-04T00:00:00.000Z' })
  const onlyBatch = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.filter((row: Record<string, unknown>) => Number(row.id) <= -2026110301 && Number(row.id) >= -2026110324)])) as unknown as DecryptedDataResponse
  expect(onlyBatch.exerciseData).toHaveLength(8)
  expect(onlyBatch.foodData).toHaveLength(8)
  expect(onlyBatch.insulinData).toHaveLength(8)
  const rows = [...onlyBatch.exerciseData, ...onlyBatch.foodData, ...onlyBatch.insulinData]
  expect(rows.every(row => row.username === TARGET)).toBe(true)
  expect(onlyBatch.foodData[0]?.food_type).toMatch(/^DRtest/)
  expect(onlyBatch.exerciseData[0]?.exercise_description).toContain('DR-20261103-v1')
  const csv = buildHealthCsvDocument(onlyBatch)
  expect(csv.trim().split('\n')).toHaveLength(25)
  expect(csv).not.toMatch(/password|_iv|cipher|secret/i)
  expect(csv).toContain('ejercicio sintético')
  await mkdir('test-results/dashboard-remaking', { recursive: true })
  await writeFile('test-results/dashboard-remaking/seed-health.csv', csv, 'utf8')
  await writeFile('test-results/dashboard-remaking/seed-health.json', JSON.stringify(onlyBatch), 'utf8')
}, 30_000)

it.skipIf(process.env.DR_VERIFY_LIVE_SEED !== '1')('reads the complete real health dataset without exposing record values', async () => {
  const data = await liveRepository().getDecryptedData({ selectedUser: null, selectedDataType: 'all', timeRange: 'all', dateFilter: null, dateFrom: null, dateTo: null, from: null, to: new Date().toISOString() })
  const collections = Object.entries(data) as [string, Record<string, unknown>[]][]
  const rows = collections.flatMap(([, records]) => records)
  expect(rows.length).toBeGreaterThanOrEqual(24)
  expect(rows.some(row => Number(row.id) === -2026110301)).toBe(true)
  const report = { readOnly: true, counts: Object.fromEntries(collections.map(([name, records]) => [name, records.length])), totalRecords: rows.length, distinctUserCount: new Set(rows.map(row => row.username)).size, decryptionSucceeded: true }
  await mkdir('test-results/dashboard-remaking', { recursive: true })
  await writeFile('test-results/dashboard-remaking/live-data-counts.json', JSON.stringify(report), 'utf8')
}, 30_000)
