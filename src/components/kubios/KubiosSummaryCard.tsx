'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, Clock, Heart, TrendingUp } from 'lucide-react'
import { usePermissions } from '@/components/RoleGuard'
import { useLanguage } from '@/contexts/LanguageContext'
import ReadinessSparkline from '@/components/kubios/ReadinessSparkline'
import {
  kubiosErrorTranslationKey,
  useKubiosPersonal,
} from '@/hooks/useKubiosPersonal'
import {
  formatKubiosDate,
  formatKubiosMetric,
  parseKubiosDate,
} from '@/lib/kubios-personal'

/** Nº máximo de mediciones que muestra la mini-tendencia de readiness. */
const SPARKLINE_MAX_MEASUREMENTS = 14

/**
 * Resumen compacto de las mediciones Kubios propias. La tarjeta y la vista
 * /kubios consumen la misma vista derivada: solo se anuncia contenido cuando
 * hay un estado ready/stale con mediciones. Si falla la serie de resultados
 * pero /me conserva el resumen, la tarjeta mantiene ese resumen y muestra el
 * error, igual que la página; nunca inventa una lista ni oculta el fallo.
 */
export default function KubiosSummaryCard() {
  const { t, language } = useLanguage()
  const { hasPermission } = usePermissions()
  const { view } = useKubiosPersonal({ from: '', to: '' })

  if (!hasPermission('view_own_kubios')) return null
  if (!view.available) return null

  const { latest, measurementCount, syncedAt } = view
  const readiness = latest?.result.readiness
  const notAvailable = t.kubios.personal.notAvailable
  const latestDate = formatKubiosDate(latest?.measured_timestamp, language, notAvailable)
  const syncedDate = formatKubiosDate(syncedAt, language, notAvailable)
  const readinessText = formatKubiosMetric(readiness, 1, notAvailable)
  const isStale = view.stale
  const hasError = view.error !== null
  // Mini-tendencia de readiness: cronológica ascendente, solo mediciones con
  // fecha válida, huecos conservados y limitada a las últimas mediciones.
  const readinessSeries = view.results
    .map((result) => {
      const date = parseKubiosDate(result.measured_timestamp)
      const readiness =
        typeof result.result.readiness === 'number' &&
        Number.isFinite(result.result.readiness)
          ? result.result.readiness
          : null
      return { time: date?.getTime() ?? Number.NaN, readiness }
    })
    .filter((row) => Number.isFinite(row.time))
    .sort((a, b) => a.time - b.time)
    .slice(-SPARKLINE_MAX_MEASUREMENTS)
    .map((row) => row.readiness)

  return (
    <Link href="/kubios" className="group block" aria-label={t.kubios.personal.viewDetails}>
      <div className="relative h-full bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-indigo-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/10">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-6">
            <div className="p-4 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl shadow-lg group-hover:shadow-indigo-600/50 transition-all duration-300">
              <Heart className="h-8 w-8 text-white" />
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-indigo-800 group-hover:text-indigo-600 transition-colors">
                {measurementCount.toLocaleString(language === 'en' ? 'en-US' : 'es-ES')}
              </div>
              <div className="text-xs text-indigo-600/70">{t.kubios.measurements}</div>
            </div>
          </div>

          <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-indigo-700 transition-colors">
            {t.kubios.personal.summaryTitle}
          </h3>
          <p className="text-gray-600 text-sm leading-relaxed mb-4">
            {t.kubios.personal.summaryDescription}
          </p>

          <dl className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                {t.kubios.personal.latestReadiness}
              </dt>
              <dd className="mt-1 flex items-center gap-1 text-lg font-bold text-indigo-700">
                <TrendingUp className="h-4 w-4" />
                {readinessText === notAvailable ? notAvailable : `${readinessText}%`}
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                {t.kubios.personal.latestMeasurement}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800 truncate" title={latestDate}>
                {latestDate}
              </dd>
            </div>
          </dl>

          {readinessSeries.length > 1 && (
            <ReadinessSparkline
              values={readinessSeries}
              ariaLabel={t.kubios.personal.readinessSparklineAria}
            />
          )}

          <div className="mb-4 flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span className="truncate" title={syncedDate}>
              {t.kubios.personal.syncedAt}: {syncedDate}
            </span>
          </div>

          {(isStale || hasError) && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                {isStale
                  ? t.kubios.personal.staleWarning
                  : t.kubios.personal[kubiosErrorTranslationKey(view.error)]}
              </span>
            </div>
          )}
          {isStale && hasError && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                {t.kubios.personal[kubiosErrorTranslationKey(view.error)]}
              </span>
            </div>
          )}

          <div className="flex items-center text-indigo-600 text-sm font-medium">
            <span>{t.kubios.personal.viewDetails}</span>
            <ArrowUpRight className="h-4 w-4 ml-2 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </div>
        </div>
      </div>
    </Link>
  )
}
