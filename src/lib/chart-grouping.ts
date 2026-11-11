export interface NamedValue {
  readonly name: string
  readonly value: number
}

export interface PieSlices {
  /** Nombres principales conservados, ordenados de mayor a menor valor. */
  readonly slices: NamedValue[]
  /** Cola agregada en una sola entrada; null cuando ya caben en los principales. */
  readonly others: NamedValue | null
  /** Nombres agregados en others, ordenados de mayor a menor valor. */
  readonly othersBreakdown: NamedValue[]
}

const byValueDescending = (a: NamedValue, b: NamedValue): number => b.value - a.value

function sumAll(entries: readonly NamedValue[], name: string): NamedValue {
  return { name, value: entries.reduce((total, entry) => total + entry.value, 0) }
}

/**
 * Agrupa los nombres menos representativos de un pie chart en una única
 * entrada "Otros" con el porcentaje/valor sumado, para que el gráfico siga
 * siendo legible cuando hay demasiados tipos. Solo los `topCount` primeros
 * nombres se muestran individualmente; el resto se devuelve en `others`
 * junto con su desglose para poder mostrarlo en un desplegable.
 */
export function aggregatePieTail(
  entries: readonly NamedValue[],
  topCount: number,
  othersName: string,
): PieSlices {
  const sorted = [...entries].sort(byValueDescending)
  const kept = sorted.slice(0, Math.max(0, topCount))
  const tail = sorted.slice(kept.length)
  return {
    slices: kept,
    others: tail.length > 0 ? sumAll(tail, othersName) : null,
    othersBreakdown: tail,
  }
}
