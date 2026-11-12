import { describe, expect, it } from 'vitest'

import {
  canonicalTimestamp,
  isPlainRecord,
  normalizeSnapshotRow,
  tryParseJsonObject
} from '@/lib/kubios-snapshot-shape'

/**
 * Forma legada del snapshot de Kubios (MT48): filas con `result` serializado
 * como cadena JSON y marcas de tiempo numéricas o con alias. La
 * normalización compartida debe recuperarlos sin inventar datos ni mutar la
 * fila original.
 */
describe('kubios-snapshot-shape', () => {
  describe('isPlainRecord', () => {
    it('accepts plain objects and rejects arrays and primitives', () => {
      expect(isPlainRecord({})).toBe(true)
      expect(isPlainRecord({ result: 1 })).toBe(true)
      expect(isPlainRecord([])).toBe(false)
      expect(isPlainRecord(null)).toBe(false)
      expect(isPlainRecord('x')).toBe(false)
    })
  })

  describe('tryParseJsonObject', () => {
    it('parses strict JSON objects and rejects everything else', () => {
      expect(tryParseJsonObject('{"readiness":60}')).toEqual({ readiness: 60 })
      expect(tryParseJsonObject('  {"a":1}  ')).toEqual({ a: 1 })
      expect(tryParseJsonObject('[1,2]')).toBeNull()
      expect(tryParseJsonObject('"json-string"')).toBeNull()
      expect(tryParseJsonObject('{invalid}')).toBeNull()
      expect(tryParseJsonObject('')).toBeNull()
      expect(tryParseJsonObject(null)).toBeNull()
      expect(tryParseJsonObject(42)).toBeNull()
    })
  })

  describe('canonicalTimestamp', () => {
    it('canonicalizes parseable date strings to ISO UTC', () => {
      expect(canonicalTimestamp('2026-11-03T10:00:00Z')).toBe('2026-11-03T10:00:00.000Z')
      expect(canonicalTimestamp('2026-11-03 10:00:00')).toBe('2026-11-03T10:00:00.000Z')
    })

    it('converts numeric epochs in seconds and milliseconds', () => {
      const ms = Date.parse('2026-11-03T10:00:00.000Z')
      expect(canonicalTimestamp(ms)).toBe('2026-11-03T10:00:00.000Z')
      expect(canonicalTimestamp(Math.floor(ms / 1000))).toBe('2026-11-03T10:00:00.000Z')
    })

    it('returns null for unverifiable values', () => {
      expect(canonicalTimestamp('invalid')).toBeNull()
      expect(canonicalTimestamp('')).toBeNull()
      expect(canonicalTimestamp('   ')).toBeNull()
      expect(canonicalTimestamp(Number.NaN)).toBeNull()
      expect(canonicalTimestamp(null)).toBeNull()
      expect(canonicalTimestamp({})).toBeNull()
    })
  })

  describe('normalizeSnapshotRow', () => {
    it('recovers metrics stored as a JSON string', () => {
      const row = {
        measured_timestamp: '2026-11-03T10:00:00Z',
        result: '{"readiness":60,"mean_hr_bpm":55,"freq_domain":{"HF_power":2}}'
      }
      const normalized = normalizeSnapshotRow(row)

      expect(normalized.result).toEqual({
        readiness: 60,
        mean_hr_bpm: 55,
        freq_domain: { HF_power: 2 }
      })
      // La fila original no se muta.
      expect(row.result).toBe('{"readiness":60,"mean_hr_bpm":55,"freq_domain":{"HF_power":2}}')
    })

    it('keeps a non-object result untouched for the consumers to report', () => {
      const row = { measured_timestamp: '2026-11-03T10:00:00Z', result: 'not-json' }
      expect(normalizeSnapshotRow(row).result).toBe('not-json')
    })

    it('fills measured_timestamp from the timestamp alias', () => {
      const row = { timestamp: '2026-11-03T10:00:00Z' }
      expect(normalizeSnapshotRow(row).measured_timestamp).toBe('2026-11-03T10:00:00.000Z')
    })

    it('converts numeric epochs in measured_timestamp and the alias', () => {
      const ms = Date.parse('2026-11-03T10:00:00.000Z')
      const secondsRow = normalizeSnapshotRow({ timestamp: Math.floor(ms / 1000) })
      expect(secondsRow.measured_timestamp).toBe('2026-11-03T10:00:00.000Z')

      const msRow = normalizeSnapshotRow({ measured_timestamp: ms })
      expect(msRow.measured_timestamp).toBe('2026-11-03T10:00:00.000Z')
    })

    it('keeps the measured_timestamp over an invalid alias', () => {
      const row = {
        measured_timestamp: '2026-11-03T10:00:00Z',
        timestamp: 'garbage'
      }
      expect(normalizeSnapshotRow(row).measured_timestamp).toBe('2026-11-03T10:00:00.000Z')
    })

    it('leaves unknown extra fields intact and canonicalizes the timestamp', () => {
      const row = {
        measured_timestamp: '2026-11-03T10:00:00Z',
        result: {},
        user_happiness: 8,
        internal_secret: 'SYNTHETIC_SECRET'
      }
      expect(normalizeSnapshotRow(row)).toEqual({
        measured_timestamp: '2026-11-03T10:00:00.000Z',
        result: {},
        user_happiness: 8,
        internal_secret: 'SYNTHETIC_SECRET'
      })
    })
  })
})
