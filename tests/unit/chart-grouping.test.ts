import { describe, expect, it } from 'vitest'
import { aggregatePieTail, pieLabelText, shouldLabelPieSlice, summarizeDosesByDate, type NamedValue } from '@/lib/chart-grouping'

const TOP = 5
const OTHERS_NAME = 'Otros'

function names(values: readonly NamedValue[]): string[] {
  return values.map((entry) => entry.name)
}

describe('aggregatePieTail: pie chart con entrada "Otros"', () => {
  it('conserva los principales y suma el resto en otros con su desglose', () => {
    const entries: NamedValue[] = [
      { name: 'glargina', value: 40 },
      { name: 'rápida', value: 30 },
      { name: 'regular', value: 12 },
      { name: 'detemir', value: 8 },
      { name: 'degludec', value: 6 },
      { name: 'lispro', value: 3 },
      { name: 'aspart', value: 1 },
    ]

    const result = aggregatePieTail(entries, TOP, OTHERS_NAME)

    expect(names(result.slices)).toEqual(['glargina', 'rápida', 'regular', 'detemir', 'degludec'])
    expect(result.others).toEqual({ name: OTHERS_NAME, value: 4 })
    expect(names(result.othersBreakdown)).toEqual(['lispro', 'aspart'])
  })

  it('devuelve otros nulo cuando todos los tipos caben en los principales', () => {
    const entries: NamedValue[] = [
      { name: 'glargina', value: 10 },
      { name: 'rápida', value: 4 },
    ]

    const result = aggregatePieTail(entries, TOP, OTHERS_NAME)

    expect(result.slices).toHaveLength(2)
    expect(result.others).toBeNull()
    expect(result.othersBreakdown).toHaveLength(0)
  })

  it('con topCount 0 agrega todas las entradas en otros', () => {
    const entries: NamedValue[] = [
      { name: 'a', value: 2 },
      { name: 'b', value: 1 },
    ]

    const result = aggregatePieTail(entries, 0, OTHERS_NAME)

    expect(result.slices).toHaveLength(0)
    expect(result.others).toEqual({ name: OTHERS_NAME, value: 3 })
    expect(names(result.othersBreakdown)).toEqual(['a', 'b'])
  })

  it('ordena los principales de mayor a menor aunque la entrada venga desordenada', () => {
    const entries: NamedValue[] = [
      { name: 'menor', value: 1 },
      { name: 'mayor', value: 9 },
      { name: 'media', value: 5 },
    ]

    const result = aggregatePieTail(entries, 2, OTHERS_NAME)

    expect(names(result.slices)).toEqual(['mayor', 'media'])
    expect(result.others).toEqual({ name: OTHERS_NAME, value: 1 })
    expect(names(result.othersBreakdown)).toEqual(['menor'])
  })

  it('el desglose de otros siempre suma el valor del sector otros', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      name: `tipo-${index + 1}`,
      value: 12 - index,
    }))

    const result = aggregatePieTail(entries, TOP, OTHERS_NAME)

    const breakdownTotal = result.othersBreakdown.reduce((total, entry) => total + entry.value, 0)
    expect(result.others?.value).toBe(breakdownTotal)
  })

  it('mantiene el orden de entrada ante empates (orden estable)', () => {
    const entries: NamedValue[] = [
      { name: 'primero', value: 5 },
      { name: 'segundo', value: 5 },
      { name: 'tercero', value: 5 },
    ]

    const result = aggregatePieTail(entries, 2, OTHERS_NAME)

    expect(names(result.slices)).toEqual(['primero', 'segundo'])
    expect(names(result.othersBreakdown)).toEqual(['tercero'])
  })

  it('no muta la colección original', () => {
    const entries: NamedValue[] = [
      { name: 'b', value: 1 },
      { name: 'a', value: 2 },
    ]

    aggregatePieTail(entries, TOP, OTHERS_NAME)

    expect(names(entries)).toEqual(['b', 'a'])
  })

  it('devuelve otros nulo con una colección vacía', () => {
    const result = aggregatePieTail([], TOP, OTHERS_NAME)

    expect(result.slices).toHaveLength(0)
    expect(result.others).toBeNull()
    expect(result.othersBreakdown).toHaveLength(0)
  })
})

describe('pie slice labels: umbral y texto para evitar el solape', () => {
  it('oculta los sectores diminotos y conserva los representativos', () => {
    expect(shouldLabelPieSlice(0)).toBe(false)          // sector de 0%
    expect(shouldLabelPieSlice(0.03)).toBe(false)       // Otros 3%
    expect(shouldLabelPieSlice(0.049)).toBe(false)
    expect(shouldLabelPieSlice(0.05)).toBe(true)        // borde del umbral
    expect(shouldLabelPieSlice(0.3)).toBe(true)         // Lenta 30%
    expect(shouldLabelPieSlice(0.66)).toBe(true)        // Rápida 66%
  })
  it('oculta cuando recharts no puede calcular el porcentaje', () => {
    expect(shouldLabelPieSlice(Number.NaN)).toBe(false)
  })
  it('redondea el porcentaje sin decimales y usa el nombre del sector', () => {
    expect(pieLabelText('Rápida', 0.66)).toBe('Rápida 66%')
    expect(pieLabelText('Lenta', 0.3)).toBe('Lenta 30%')
    expect(pieLabelText('Otros', 0.0333)).toBe('Otros 3%')
  })
})

describe('summarizeDosesByDate: inyecciones y promedio de dosis por día', () => {
  interface DoseRow { readonly day: string; readonly dose: string }

  const row = (day: string, dose: string): DoseRow => ({ day, dose })
  const dateOf = (r: DoseRow) => r.day
  const doseOf = (r: DoseRow) => parseFloat(r.dose || '0')

  it('cuenta inyecciones y calcula el promedio redondeado a 1 decimal por día', () => {
    const rows = [row('1 nov', '2'), row('1 nov', '4'), row('1 nov', '3.5'), row('2 nov', '1')]

    expect(summarizeDosesByDate(rows, dateOf, doseOf)).toEqual([
      { date: '1 nov', injections: 3, averageDose: 3.2 },
      { date: '2 nov', injections: 1, averageDose: 1 },
    ])
  })
  it('trata la dosis ausente o no numérica como 0', () => {
    const rows = [row('1 nov', ''), row('1 nov', '3'), row('1 nov', 'abc')]

    expect(summarizeDosesByDate(rows, dateOf, doseOf)).toEqual([
      { date: '1 nov', injections: 3, averageDose: 1 },
    ])
  })
  it('ordena cronológicamente aunque la entrada venga desordenada', () => {
    const rows = [row('10 nov', '1'), row('1 nov', '1'), row('5 nov', '1')]

    expect(summarizeDosesByDate(rows, dateOf, doseOf).map(s => s.date)).toEqual(['1 nov', '5 nov', '10 nov'])
  })
  it('no muta la colección original', () => {
    const rows = [row('2 nov', '1'), row('1 nov', '1')]

    summarizeDosesByDate(rows, dateOf, doseOf)

    expect(rows.map(r => r.day)).toEqual(['2 nov', '1 nov'])
  })
  it('devuelve una colección vacía sin datos', () => {
    expect(summarizeDosesByDate([], dateOf, doseOf)).toEqual([])
  })
})
