import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLoginIdentityAttempts,
  toLoginInput,
} from '@/components/dashboard-shell/login-identity'
import {
  canAccessShellPath,
  findShellRouteAccessRule,
  normalizeShellPath,
} from '@/components/dashboard-shell/route-access'
import {
  countRecords,
  hasAnyRecords,
  hasMetricValue,
} from '@/components/dashboard-shell/metrics'
import { translations } from '@/lib/translations'

const root = process.cwd()

function readSource(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flattenKeys(child, prefix.length === 0 ? key : `${prefix}.${key}`),
  )
}

describe('login unificado: una sola credencial inicial', () => {
  it('envía un identificador con arroba como email y deja el legado al backend', () => {
    expect(buildLoginIdentityAttempts('javier.alayón@ulpgc.es')).toEqual([
      { kind: 'email', value: 'javier.alayón@ulpgc.es' },
    ])
  })

  it('envía un identificador sin arroba como nombre de participante', () => {
    expect(buildLoginIdentityAttempts('  participante_01  ')).toEqual([
      { kind: 'username', value: 'participante_01' },
    ])
  })

  it('no reintenta otro método tras un 401 y no acepta entradas vacías', () => {
    expect(buildLoginIdentityAttempts('   ')).toEqual([])
    expect(buildLoginIdentityAttempts('persona@ejemplo.test')).toHaveLength(1)
  })

  it('construye el contrato exacto del backend', () => {
    expect(toLoginInput({ kind: 'email', value: 'a@b.test' }, 'secreta')).toEqual({
      email: 'a@b.test',
      password: 'secreta',
    })
    expect(toLoginInput({ kind: 'username', value: 'ana' }, 'secreta')).toEqual({
      username: 'ana',
      password: 'secreta',
    })
  })
})

describe('política central de rutas restringidas', () => {
  it('normaliza rutas con barra final y consulta', () => {
    expect(normalizeShellPath('/users/')).toBe('/users')
    expect(normalizeShellPath('/data?range=all')).toBe('/data')
    expect(normalizeShellPath('')).toBe('/')
  })

  it('impide que un usuario normal abra rutas administrativas o de equipo', () => {
    expect(canAccessShellPath('user', '/')).toBe(true)
    expect(canAccessShellPath('user', '/data')).toBe(true)
    expect(canAccessShellPath('user', '/overview')).toBe(false)
    expect(canAccessShellPath('user', '/users')).toBe(false)
    expect(canAccessShellPath('user', '/admin')).toBe(false)
    expect(canAccessShellPath('user', '/study')).toBe(false)
  })

  it('conserva las restricciones del rol doctor sin conceder administración', () => {
    expect(canAccessShellPath('doctor', '/overview')).toBe(true)
    expect(canAccessShellPath('doctor', '/users')).toBe(true)
    expect(canAccessShellPath('doctor', '/study')).toBe(true)
    expect(canAccessShellPath('doctor', '/admin')).toBe(false)
  })

  it('permite al admin las vistas administrativas y no confunde prefijos', () => {
    expect(canAccessShellPath('admin', '/admin/database')).toBe(true)
    expect(canAccessShellPath('admin', '/users')).toBe(true)
    expect(findShellRouteAccessRule('/administracion')).toBeNull()
  })
})

describe('métricas vacías frente a valores reales', () => {
  it('conserva cero, false y cadenas con contenido', () => {
    expect(hasMetricValue(0)).toBe(true)
    expect(hasMetricValue(false)).toBe(true)
    expect(hasMetricValue('0')).toBe(true)
  })

  it('oculta null, undefined, NaN y cadena vacía', () => {
    expect(hasMetricValue(null)).toBe(false)
    expect(hasMetricValue(undefined)).toBe(false)
    expect(hasMetricValue(Number.NaN)).toBe(false)
    expect(hasMetricValue('   ')).toBe(false)
  })

  it('cuenta solo colecciones con registros reales', () => {
    expect(countRecords([1, 2], [])).toBe(2)
    expect(hasAnyRecords([], [])).toBe(false)
    expect(hasAnyRecords([], [{ id: 1 }])).toBe(true)
  })
})

describe('diccionario ES/EN', () => {
  it('mantiene exactamente las mismas claves en ambos idiomas', () => {
    expect(flattenKeys(translations.en).sort()).toEqual(
      flattenKeys(translations.es).sort(),
    )
  })

  it('no deja valores vacíos', () => {
    for (const language of ['es', 'en'] as const) {
      const entries = Object.entries(translations[language])
      expect(entries.length).toBeGreaterThan(0)
    }
    expect(translations.es.study.noStudyData.length).toBeGreaterThan(0)
    expect(translations.en.study.noStudyData.length).toBeGreaterThan(0)
  })

  it('retira los posesivos de las etiquetas principales', () => {
    const labelGroups = [
      translations.es.data.myData,
      translations.es.dashboard.myRecords,
      translations.es.dashboard.myHrv,
      translations.es.dashboard.appDashboard.myHealthData,
      translations.es.dashboard.appDashboard.myStatistics,
      translations.en.data.myData,
      translations.en.dashboard.myRecords,
      translations.en.dashboard.myHrv,
      translations.en.dashboard.appDashboard.myHealthData,
      translations.en.dashboard.appDashboard.myStatistics,
    ]

    for (const label of labelGroups) {
      expect(label).not.toMatch(/\b(Mis|Mi|Tus|Tu|My|Your)\b/)
    }
    expect(translations.es.kubios.personal.summaryTitle).toContain('Kubios')
  })
})

describe('estructura del shell', () => {
  it('mantiene las rutas antiguas como redirecciones', () => {
    expect(readSource('src/app/app-login/page.tsx')).toContain("redirect('/login')")
    expect(readSource('src/app/app-dashboard/page.tsx')).toContain("redirect('/')")
  })

  it('monta el selector de idioma una sola vez en el layout compartido', () => {
    const layout = readSource('src/app/layout.tsx')
    expect(layout).toContain('GlobalLanguageSelector')
    expect(layout).toContain('<GlobalLanguageSelector />')
  })

  it('usa el login unificado sin selector de rol ni reintento de credencial', () => {
    const login = readSource('src/app/login/page.tsx')
    expect(login).toContain('buildLoginIdentityAttempts')
    expect(login).not.toContain('shouldTryNextCredential')
    expect(login).not.toContain('role-select')
    expect(login).toContain('t.auth.identifier')
  })

  it('devuelve al inicio común desde los controles de regreso', () => {
    expect(readSource('src/components/Navigation.tsx')).toContain('<Link href="/"')
    expect(readSource('src/components/HybridNavigation.tsx')).toContain("const backHref = '/'")
    expect(readSource('src/components/SimpleNavigation.tsx')).toContain("const backHref = '/'")
  })

  it('comparte el mismo origen y criterio entre la tarjeta y la vista Kubios', () => {
    const card = readSource('src/components/kubios/KubiosSummaryCard.tsx')
    const page = readSource('src/app/kubios/page.tsx')

    for (const source of [card, page]) {
      expect(source).toContain('useKubiosPersonal')
      expect(source).not.toMatch(/localStorage|sessionStorage/)
    }
    expect(card).toContain('view.available')
  })
})
