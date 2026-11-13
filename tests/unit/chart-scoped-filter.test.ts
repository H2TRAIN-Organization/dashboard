import { describe, expect, it } from 'vitest'
import {
  healthRecordTimestamp,
  lastDaysRange,
  recordTimestamp,
  recordsWithinRange,
  startOfLocalDay,
} from '@/lib/chart-scoped-filter'

describe('recordTimestamp', () => {
  it('interpreta cadenas de fecha ISO y descarta el texto sin fecha', () => {
    expect(recordTimestamp('2026-10-15T09:30:00.000Z')).not.toBeNull()
    expect(recordTimestamp('sin fecha')).toBeNull()
    expect(recordTimestamp('')).toBeNull()
    expect(recordTimestamp(null)).toBeNull()
    expect(recordTimestamp(undefined)).toBeNull()
  })

  it('acepta Date válidos y descarta Date inválidos', () => {
    expect(recordTimestamp(new Date('2026-10-15T09:30:00.000Z'))).not.toBeNull()
    expect(recordTimestamp(new Date('no es una fecha'))).toBeNull()
  })
})

describe('healthRecordTimestamp', () => {
  it('usa date_time y cae a startDate cuando aquella no existe', () => {
    expect(healthRecordTimestamp({ date_time: '2026-10-15T09:30:00.000Z' })).not.toBeNull()
    expect(healthRecordTimestamp({ startDate: '2026-10-15T09:30:00.000Z' })).not.toBeNull()
    expect(healthRecordTimestamp({ date_time: 'roto', startDate: '2026-10-15T09:30:00.000Z' })).not.toBeNull()
    expect(healthRecordTimestamp({})).toBeNull()
  })
})

describe('startOfLocalDay y lastDaysRange', () => {
  it('startOfLocalDay deja el día a medianoche local', () => {
    const now = new Date('2026-10-15T18:45:00').getTime()
    const start = startOfLocalDay(now)
    const parsed = new Date(start)
    expect(parsed.getHours()).toBe(0)
    expect(parsed.getMinutes()).toBe(0)
    expect(parsed.getDate()).toBe(15)
  })

  it('lastDaysRange cubre los días naturales pedidos incluido hoy', () => {
    const now = new Date('2026-10-15T18:45:00').getTime()
    const range = lastDaysRange(7, now)
    const expectedFrom = startOfLocalDay(new Date('2026-10-09T18:45:00').getTime())
    expect(range.fromMs).toBe(expectedFrom)
    expect(range.toMs).toBe(now)
  })
})

describe('recordsWithinRange', () => {
  const rows = [
    { id: 'dentro', date_time: '2026-10-14T10:00:00' },
    { id: 'fuera', date_time: '2026-10-01T10:00:00' },
    { id: 'sin-fecha', date_time: '' },
    { id: 'periodo', startDate: '2026-10-13T08:00:00' },
  ]

  it('sin filtro propio devuelve las mismas filas', () => {
    const result = recordsWithinRange(rows, null, healthRecordTimestamp)
    expect(result).toHaveLength(rows.length)
  })

  it('con rango activo mantiene solo las filas dentro y excluye las sin fecha', () => {
    const now = new Date('2026-10-15T18:45:00').getTime()
    const range = lastDaysRange(7, now)
    const result = recordsWithinRange(rows, range, healthRecordTimestamp)
    expect(result.map((row) => row.id)).toEqual(['dentro', 'periodo'])
  })

  it('no muta la lista original', () => {
    const original = [...rows]
    const now = new Date('2026-10-15T18:45:00').getTime()
    recordsWithinRange(rows, lastDaysRange(7, now), healthRecordTimestamp)
    expect(rows).toEqual(original)
  })
})
