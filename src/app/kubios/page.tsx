'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Calendar,
  Download,
  Filter,
  Heart,
  RefreshCw,
  TrendingUp,
  X,
} from 'lucide-react'
import HRVCharts from '@/components/HRVCharts'
import Navigation from '@/components/Navigation'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleGuard from '@/components/RoleGuard'
import { useLanguage } from '@/contexts/LanguageContext'
import { useSession } from '@/contexts/SessionContext'
import { useKubiosHrvResults, useKubiosMe } from '@/hooks/useKubiosPersonal'
import { buildKubiosCsv, buildKubiosCsvFilename } from '@/lib/kubios-csv'
import {
  formatKubiosDate,
  formatKubiosMetric,
  formatKubiosText,
  getKubiosFreqDomain,
  isKubiosDataStatus,
  sortKubiosResults,
  type KubiosErrorKind,
} from '@/lib/kubios-personal'

type KubiosTranslations = ReturnType<typeof useLanguage>['t']

function errorMessage(error: KubiosErrorKind | null, t: KubiosTranslations): string {
  switch (error) {
    case 'unauthorized':
      return t.kubios.personal.sessionExpired
    case 'unavailable':
      return t.kubios.personal.serviceUnavailable
    case 'invalid-query':
      return t.kubios.personal.invalidDateRange
    case 'contract':
      return t.kubios.personal.invalidResponse
    default:
      return t.kubios.personal.loadError
  }
}

function readinessClasses(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'bg-slate-200 text-slate-700'
  }
  if (value >= 80) return 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
  if (value >= 60) return 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
  if (value >= 40) return 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white'
  return 'bg-gradient-to-r from-red-500 to-rose-500 text-white'
}

function StatusPanel({
  icon,
  title,
  message,
}: {
  icon: ReactNode
  title: string
  message: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
        {icon}
      </div>
      <h4 className="text-lg font-bold text-slate-900 mb-2">{title}</h4>
      <p className="max-w-xl text-sm sm:text-base font-medium text-slate-600">{message}</p>
    </div>
  )
}

function KubiosPersonalContent() {
  const { t, language } = useLanguage()
  const { session } = useSession()
  const sessionUserId = session?.user.id ?? null

  const [filter, setFilter] = useState({ from: '', to: '' })
  const [charts, setCharts] = useState({ open: false, key: '' })

  const me = useKubiosMe()
  const hrv = useKubiosHrvResults(filter)

  const filterKey = `${filter.from}|${filter.to}`
  const chartsKey = `${sessionUserId ?? ''}|${filterKey}`
  const chartsVisible = charts.open && charts.key === chartsKey

  const toggleCharts = () => {
    setCharts((previous) =>
      previous.open && previous.key === chartsKey
        ? { open: false, key: chartsKey }
        : { open: true, key: chartsKey },
    )
  }

  const data = hrv.view.phase === 'data' ? hrv.view.data : null
  const status = data?.status ?? null
  const hasDataStatus = isKubiosDataStatus(status)
  const meData = me.view.phase === 'data' ? me.view.data : null
  const meHasData =
    meData !== null && isKubiosDataStatus(meData.status)
  const results = useMemo(
    () => (data === null ? [] : sortKubiosResults(data.results)),
    [data],
  )

  // Con un rango activo, cabecera y lista deben describir el mismo conjunto:
  // los resultados filtrados vigentes. El resumen global de /me solo se usa
  // sin filtro; `synced_at` sigue siendo la fecha del snapshot global.
  const filterActive = filter.from.length > 0 || filter.to.length > 0
  const resultCount = results.length
  const filteredLatest = results[0] ?? null
  const totalMeasurements = filterActive
    ? resultCount
    : meHasData
      ? meData.measurement_count
      : resultCount
  const latest = filterActive
    ? filteredLatest
    : (meHasData ? meData.latest_result : null) ?? filteredLatest
  const syncedAt =
    data?.synced_at ?? (meHasData ? meData.synced_at : null)
  const stale = status === 'stale'
  const canExport = sessionUserId !== null && hasDataStatus && resultCount > 0
  const showFilters =
    status === 'empty' ||
    hasDataStatus ||
    hrv.view.phase === 'error' ||
    hrv.view.phase === 'loading'

  const notAvailable = t.kubios.personal.notAvailable
  const latestDate = formatKubiosDate(
    latest?.measured_timestamp,
    language,
    notAvailable,
  )
  const syncedDate = formatKubiosDate(syncedAt, language, notAvailable)
  const latestReadiness = latest?.result.readiness
  const latestReadinessText = formatKubiosMetric(latestReadiness, 1, notAvailable)
  const readinessLevel =
    typeof latestReadiness === 'number' && Number.isFinite(latestReadiness)
      ? latestReadiness >= 80
        ? t.kubios.readinessLevels.high
        : latestReadiness >= 60
          ? t.kubios.readinessLevels.normal
          : latestReadiness >= 40
            ? t.kubios.readinessLevels.low
            : t.kubios.readinessLevels.veryLow
      : null

  const handleRefresh = () => {
    me.reload()
    hrv.reload()
  }

  // Descarga local: solo se serializan los resultados propios ya cargados para
  // la sesión y el filtro actuales. No hay fetch, token ni caché implicados.
  const handleExport = () => {
    if (!canExport) return

    const csv = buildKubiosCsv(
      results as unknown as Parameters<typeof buildKubiosCsv>[0],
    )
    if (!csv) return

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = buildKubiosCsvFilename(new Date())
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const loading = hrv.view.phase === 'loading' || hrv.view.phase === 'idle'

  return (
    <>
      <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-5 sm:p-8 mb-6 sm:mb-8 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3 sm:p-4 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl shadow-lg flex-shrink-0">
              <Heart className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
                {t.kubios.personal.summaryTitle}
              </h2>
              <p className="mt-1 text-sm sm:text-base text-gray-600">
                {t.kubios.personal.summaryDescription}
              </p>
              <span className="mt-3 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                {t.kubios.personal.onlyOwnData}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full lg:w-auto">
            {hasDataStatus && (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    {t.kubios.measurements}
                  </p>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {totalMeasurements.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    {t.kubios.personal.latestMeasurement}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 truncate" title={latestDate}>
                    {latestDate}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    {t.kubios.personal.latestReadiness}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {latestReadinessText === notAvailable
                      ? notAvailable
                      : `${latestReadinessText}%${readinessLevel ? ` · ${readinessLevel}` : ''}`}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    {t.kubios.personal.syncedAt}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 truncate" title={syncedDate}>
                    {syncedDate}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t.common.refresh}
          </button>
          <button
            type="button"
            onClick={toggleCharts}
            disabled={resultCount === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrendingUp className="h-4 w-4" />
            {chartsVisible ? t.kubios.hideCharts : t.kubios.showCharts}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!canExport}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-green-300 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {t.data.exportCsv}
          </button>
        </div>

        {showFilters && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Filter className="h-4 w-4 text-blue-600" />
              {t.kubios.personal.filterHint}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <div>
                <label
                  htmlFor="kubios-date-from"
                  className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600"
                >
                  {t.kubios.dateFrom}
                </label>
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="kubios-date-from"
                    type="date"
                    value={filter.from}
                    max={filter.to.length > 0 ? filter.to : undefined}
                    onChange={(event) =>
                      setFilter((previous) => ({
                        ...previous,
                        from: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm font-medium text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="kubios-date-to"
                  className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600"
                >
                  {t.kubios.dateTo}
                </label>
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="kubios-date-to"
                    type="date"
                    value={filter.to}
                    min={filter.from.length > 0 ? filter.from : undefined}
                    onChange={(event) =>
                      setFilter((previous) => ({
                        ...previous,
                        to: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm font-medium text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFilter({ from: '', to: '' })}
                disabled={filter.from.length === 0 && filter.to.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                {t.kubios.personal.clearFilters}
              </button>
            </div>
          </div>
        )}

        {stale && hasDataStatus && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold">{t.kubios.personal.staleWarning}</p>
              {syncedAt && (
                <p className="mt-0.5 text-xs font-medium">
                  {t.kubios.personal.syncedAt}: {syncedDate}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xl sm:text-2xl font-bold text-slate-900">
            {t.kubios.hrvResults}
          </h3>
          {hasDataStatus && (
            <span className="inline-flex w-fit items-center rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
              {resultCount} {t.kubios.measurements}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-6 py-4 shadow-sm">
              <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
              <span className="text-sm font-medium text-slate-700">{t.data.loading}</span>
            </div>
          </div>
        ) : hrv.view.phase === 'error' ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-red-700">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  {errorMessage(hrv.view.error, t)}
                </p>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t.kubios.personal.retry}
                </button>
              </div>
            </div>
          </div>
        ) : status === 'unlinked' ? (
          <StatusPanel
            icon={<Heart className="h-10 w-10 text-blue-500" />}
            title={t.kubios.personal.summaryTitle}
            message={t.kubios.personal.statusUnlinked}
          />
        ) : status === 'pending' ? (
          <StatusPanel
            icon={<Activity className="h-10 w-10 text-blue-500" />}
            title={t.kubios.personal.summaryTitle}
            message={t.kubios.personal.statusPending}
          />
        ) : status === 'empty' ? (
          <StatusPanel
            icon={<Calendar className="h-10 w-10 text-blue-500" />}
            title={t.kubios.personal.summaryTitle}
            message={
              filter.from.length > 0 || filter.to.length > 0
                ? t.kubios.personal.emptyRange
                : t.kubios.personal.statusEmpty
            }
          />
        ) : hasDataStatus && resultCount === 0 ? (
          <StatusPanel
            icon={<Calendar className="h-10 w-10 text-blue-500" />}
            title={t.kubios.personal.summaryTitle}
            message={
              filter.from.length > 0 || filter.to.length > 0
                ? t.kubios.personal.emptyRange
                : t.kubios.personal.statusEmpty
            }
          />
        ) : hasDataStatus ? (
          <>
            {chartsVisible && (
              <div className="mb-8 rounded-2xl border border-blue-200/60 bg-white/80 p-2 sm:p-4">
                <HRVCharts results={results} />
              </div>
            )}

            <div className="space-y-5">
              {results.map((result, index) => {
                const metrics = result.result
                const frequencyDomain = getKubiosFreqDomain(result)
                const readiness = metrics.readiness
                const readinessText = formatKubiosMetric(readiness, 1, notAvailable)
                const hasReadiness =
                  typeof readiness === 'number' && Number.isFinite(readiness)
                const dateText = formatKubiosDate(
                  result.measured_timestamp,
                  language,
                  notAvailable,
                )

                const metricCards = [
                  {
                    label: t.kubios.metrics.meanHr,
                    value: formatKubiosMetric(metrics.mean_hr_bpm, 0, notAvailable),
                    unit: 'bpm',
                  },
                  {
                    label: t.kubios.metrics.rmssd,
                    value: formatKubiosMetric(metrics.rmssd_ms, 1, notAvailable),
                    unit: 'ms',
                  },
                  {
                    label: t.kubios.metrics.pnsIndex,
                    value: formatKubiosMetric(metrics.pns_index, 2, notAvailable),
                    unit: '',
                  },
                  {
                    label: t.kubios.metrics.snsIndex,
                    value: formatKubiosMetric(metrics.sns_index, 2, notAvailable),
                    unit: '',
                  },
                  {
                    label: t.kubios.metrics.physiologicalAge,
                    value: formatKubiosMetric(
                      metrics.physiological_age,
                      0,
                      notAvailable,
                    ),
                    unit: t.kubios.metrics.years,
                  },
                  {
                    label: t.kubios.metrics.respiratoryRate,
                    value: formatKubiosMetric(
                      metrics.respiratory_rate,
                      1,
                      notAvailable,
                    ),
                    unit: 'rpm',
                  },
                  {
                    label: t.kubios.metrics.stressIndex,
                    value: formatKubiosMetric(metrics.stress_index, 1, notAvailable),
                    unit: '',
                  },
                ]

                return (
                  <article
                    key={`${result.measured_timestamp ?? 'sin-fecha'}-${index}`}
                    className="rounded-2xl border border-blue-200 bg-white p-4 sm:p-6 shadow-lg"
                  >
                    <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-2.5 shadow">
                          <Calendar className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <p className="text-sm sm:text-base font-bold text-slate-900">
                            {dateText}
                          </p>
                          <p className="text-xs text-slate-600">
                            {t.kubios.personal.dailyResult}:{' '}
                            {formatKubiosText(result.daily_result, notAvailable)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`inline-flex w-fit items-center gap-2 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-bold shadow ${readinessClasses(readiness)}`}
                      >
                        <TrendingUp className="h-4 w-4" />
                        {hasReadiness
                          ? `${readinessText}% · ${
                              readinessLevelForValue(readiness, t)
                            }`
                          : notAvailable}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {metricCards.map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                            {metric.label}
                          </p>
                          <p className="mt-1 text-lg font-bold text-slate-900">
                            {metric.value}
                            {metric.unit && metric.value !== notAvailable && (
                              <span className="ml-1 text-xs font-medium text-slate-500">
                                {metric.unit}
                              </span>
                            )}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                          {t.kubios.personal.artefactLevel}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-800">
                          {formatKubiosText(metrics.artefact_level, notAvailable)}
                        </p>
                      </div>
                      {frequencyDomain !== null && (
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                            {t.kubios.metrics.freqDomain}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {[
                              ['HF_power', t.kubios.metrics.hfPower],
                              ['LF_power', t.kubios.metrics.lfPower],
                              ['VLF_power', t.kubios.metrics.vlfPower],
                              ['tot_power', t.kubios.metrics.totalPower],
                            ].map(([key, label]) => (
                              <span
                                key={key}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
                              >
                                <span className="text-slate-500">{label}</span>
                                {formatKubiosMetric(
                                  frequencyDomain[key],
                                  1,
                                  notAvailable,
                                )}
                                <span className="text-slate-400">ms²</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-6 py-4 shadow-sm">
              <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
              <span className="text-sm font-medium text-slate-700">{t.data.loading}</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function readinessLevelForValue(value: number, t: KubiosTranslations): string {
  if (value >= 80) return t.kubios.readinessLevels.high
  if (value >= 60) return t.kubios.readinessLevels.normal
  if (value >= 40) return t.kubios.readinessLevels.low
  return t.kubios.readinessLevels.veryLow
}

export default function KubiosPage() {
  const { t } = useLanguage()

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-400 opacity-10 mix-blend-multiply blur-xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-indigo-400 opacity-10 mix-blend-multiply blur-xl animate-pulse"></div>
          <div className="absolute left-1/2 top-40 h-80 w-80 rounded-full bg-purple-400 opacity-10 mix-blend-multiply blur-xl animate-pulse"></div>
        </div>

        <Navigation title={t.kubios.title} showBackButton={true} />

        <main className="relative z-10 mx-auto max-w-7xl px-3 py-6 sm:px-4 lg:px-8 lg:py-10">
          <RoleGuard requiredPermission="view_own_kubios">
            <KubiosPersonalContent />
          </RoleGuard>
        </main>
      </div>
    </ProtectedRoute>
  )
}
