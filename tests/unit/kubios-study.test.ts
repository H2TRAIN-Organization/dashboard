import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudyKubiosNotice } from '@/app/study/page'
import type { KubiosMeView } from '@/hooks/useKubiosPersonal'

const root = process.cwd()
const studyPage = readFileSync(
  path.join(root, 'src/app/study/page.tsx'),
  'utf8',
)
const studyCharts = readFileSync(
  path.join(root, 'src/components/StudyCharts.tsx'),
  'utf8',
)

function dataView(
  status: 'ready' | 'stale' | 'empty',
  measurementCount: number,
): KubiosMeView {
  return {
    phase: 'data',
    data: {
      status,
      measurement_count: measurementCount,
      synced_at: null,
      latest_result: null,
    },
    error: null,
  }
}

function renderNotice(view: KubiosMeView): string {
  return renderToStaticMarkup(createElement(StudyKubiosNotice, { view }))
}

describe('K52 Estudio sin Kubios colectivo ni ficticio', () => {
  it('does not request team users or collective HRV results', () => {
    expect(studyPage).not.toContain('/api/kubios/')
    expect(studyPage).not.toMatch(/\/api\/kubios\/team-users/)
    expect(studyPage).not.toMatch(/\/api\/kubios\/hrv-results/)
    expect(studyPage).not.toMatch(
      /selectedKubiosUser|kubiosUsers|generateHRVData/,
    )
    expect(studyPage).not.toContain('useKubiosHrvResults')
    expect(studyPage).not.toMatch(
      /hrvData|readiness_index|rmssd|moodHrv|exerciseHrv|insulinHrv/,
    )
    expect(studyPage).not.toContain('Todos los usuarios')
    expect(studyPage).not.toContain('Usuario HRV')

    const fetchTargets = Array.from(
      studyPage.matchAll(/fetch\(`([^`]+)`/g),
      (match) => match[1],
    )
    expect(fetchTargets).toHaveLength(1)
    expect(fetchTargets[0]).toContain('/api/decrypted-data?')
  })

  it('keeps the collective diabetes study without HRV metrics or cards', () => {
    expect(studyPage).toContain('/api/decrypted-data?')
    expect(studyPage).toContain("selectedUser: 'all'")
    expect(studyPage).toContain('Ejercicio ↔ Estado de Ánimo')
    expect(studyPage).toContain(
      'No hay datos suficientes para generar conclusiones del estudio',
    )
    expect(studyPage).toContain(
      'No hay datos suficientes para calcular esta correlación',
    )
    expect(studyPage).not.toMatch(/\bHRV\b/)
    expect(studyPage).not.toContain('Datos de HRV')
    expect(studyCharts).not.toMatch(/\bHRV\b|hrvData|readiness|rmssd/i)
    expect(studyCharts).toContain('Distribución de Intensidades de Ejercicio')
    expect(studyCharts).toContain('Estado de Ánimo')
  })

  it('does not log clinical data', () => {
    expect(studyPage).not.toMatch(/console\.(log|warn|error|info|debug)/)
    expect(studyCharts).not.toMatch(/console\.(log|warn|error|info|debug)/)
  })

  it('links to personal Kubios only for ready/stale with measurements', () => {
    const ready = renderNotice(dataView('ready', 2))
    expect(ready).toContain('href="/kubios"')
    expect(ready).toContain('Ver mis métricas de Kubios')

    const stale = renderNotice(dataView('stale', 1))
    expect(stale).toContain('href="/kubios"')

    for (const view of [
      dataView('ready', 0),
      dataView('stale', 0),
      dataView('empty', 3),
      { phase: 'idle', data: null, error: null } as KubiosMeView,
      {
        phase: 'error',
        data: null,
        error: 'unavailable',
      } as KubiosMeView,
    ]) {
      expect(renderNotice(view)).not.toContain('href="/kubios"')
    }
  })

  it('explains that Kubios metrics are personal even without a link', () => {
    const html = renderNotice({
      phase: 'idle',
      data: null,
      error: null,
    })

    expect(html).toContain('Kubios es personal')
    expect(html).toMatch(/no se mezclan con los datos/i)
    expect(html).toContain('vista personal de Kubios')
    expect(html).not.toContain('href="/kubios"')
  })
})
