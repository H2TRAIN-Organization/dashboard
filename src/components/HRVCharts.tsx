'use client'

import { useState } from 'react'
import { Activity, Heart, TrendingUp } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  parseKubiosDate,
  type KubiosLatestResult,
} from '@/lib/kubios-personal'
import { buildHrvChartRows, averageOfChartKey, type HrvMeasurementInput } from '@/lib/hrv-chart-rows'
import ScrollableChart from '@/components/analytics/ScrollableChart'
import { HRV_METRIC_COLORS } from '@/components/analytics/chart-theme'
import {
  ChartExpandButton,
  ChartExpandOverlay,
  useChartExpand,
} from '@/components/analytics/chart-expand'
import { Select } from '@/components/ui/select'
import { lastDaysRange, recordsWithinRange } from '@/lib/chart-scoped-filter'
import HrvLineChart, { type ChartLine } from './kubios/HrvLineChart'

interface HRVChartsProps {
  results: KubiosLatestResult[]
}

/** Ancho interior por medición en los gráficos deslizables de la vista personal. */
const INNER_WIDTH_PER_MEASUREMENT = 80
const DEFAULT_CHART_HEIGHT = 340
/** Altura del gráfico dentro del overlay expandido (MT69). */
const EXPANDED_CHART_HEIGHT = 520

function frequencyMetrics(result: unknown): Record<string, unknown> {
  if (typeof result !== 'object' || result === null) return {}
  const freqDomain = (result as Record<string, unknown>).freq_domain
  if (typeof freqDomain !== 'object' || freqDomain === null) return {}
  return freqDomain as Record<string, unknown>
}

/** Milisegundo de un resultado; `null` cuando su fecha no es interpretable. */
function resultTimestampOf(result: KubiosLatestResult): number | null {
  const date = parseKubiosDate(result.measured_timestamp)
  return date === null ? null : date.getTime()
}

/** Inputs del gráfico a partir de los resultados; los sin fecha válida fuera. */
function buildInputsFromResults(
  results: readonly KubiosLatestResult[],
): HrvMeasurementInput[] {
  const inputs: HrvMeasurementInput[] = []
  for (const result of results) {
    const date = parseKubiosDate(result.measured_timestamp)
    if (date === null) continue

    const resultMetrics =
      typeof result.result === 'object' && result.result !== null
        ? (result.result as Record<string, unknown>)
        : {}
    const metrics = { ...resultMetrics, ...frequencyMetrics(result.result) }
    inputs.push({ time: date.getTime(), metrics })
  }
  return inputs
}

/**
 * Una sección de gráfico con expansión y filtro propio (MT69): la cabecera
 * lleva el chip del rango activo y el botón de expandir, y el overlay dibuja
 * el mismo gráfico a mayor tamaño. El rango propio SOLO estrecha los
 * resultados ya cargados (client-side, src/lib/chart-scoped-filter.ts).
 */
function HrvSection({
  title,
  results,
  lines,
  yLabel,
  domain,
  collapsedHeight = DEFAULT_CHART_HEIGHT,
}: {
  title: string
  results: readonly KubiosLatestResult[]
  lines: ChartLine[]
  yLabel: string
  domain?: [number, number]
  collapsedHeight?: number
}) {
  const { t, language } = useLanguage()
  const locale = language === 'en' ? 'en-US' : 'es-ES'
  const { open, expand, collapse } = useChartExpand()
  const [days, setDays] = useState<number | null>(null)

  // "Ahora" por render: el filtro propio solo estrecha lo ya cargado (MT69).
  const nowMs = new Date().getTime()
  const scopedResults =
    days === null
      ? results
      : recordsWithinRange(results, lastDaysRange(days, nowMs), resultTimestampOf)
  const scopedRows = buildHrvChartRows(buildInputsFromResults(scopedResults), locale)

  return (
    <>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <div className="flex shrink-0 items-center gap-2">
            {days !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                {t.chart.lastNDays.replace('{days}', String(days))}
              </span>
            )}
            <ChartExpandButton onExpand={expand} />
          </div>
        </div>
        <ScrollableChart
          height={collapsedHeight}
          minInnerWidth={scopedRows.length * INNER_WIDTH_PER_MEASUREMENT}
        >
          <HrvLineChart rows={scopedRows} yLabel={yLabel} domain={domain} lines={lines} />
        </ScrollableChart>
      </div>
      <ChartExpandOverlay
        open={open}
        onClose={collapse}
        title={title}
        scopedFilter={{
          active: days !== null,
          summary:
            days !== null
              ? t.chart.lastNDays.replace('{days}', String(days))
              : undefined,
          onClear: () => setDays(null),
          node: (
            <Select
              value={days === null ? 'none' : String(days)}
              onChange={(event) =>
                setDays(event.target.value === 'none' ? null : Number(event.target.value))
              }
              aria-label={t.chart.ownFilterLabel}
              className="w-36"
            >
              <option value="none">{t.chart.ownFilterNone}</option>
              <option value="7">{t.data.last7Days}</option>
              <option value="30">{t.data.last30Days}</option>
            </Select>
          ),
        }}
        renderChart={() => (
          <ScrollableChart
            height={EXPANDED_CHART_HEIGHT}
            minInnerWidth={scopedRows.length * INNER_WIDTH_PER_MEASUREMENT}
          >
            <HrvLineChart rows={scopedRows} yLabel={yLabel} domain={domain} lines={lines} />
          </ScrollableChart>
        )}
      />
    </>
  )
}

/**
 * Gráficos de las mediciones propias. Las filas sin fecha válida no se pintan
 * y las métricas ausentes quedan como huecos (`null`); no se convierten en 0
 * ni se rellenan con datos de ejemplo.
 */
export default function HRVCharts({ results }: HRVChartsProps) {
  const { t, language } = useLanguage()
  const locale = language === 'en' ? 'en-US' : 'es-ES'
  const notAvailable = t.kubios.personal.notAvailable

  const rows = buildHrvChartRows(buildInputsFromResults(results), locale)

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm font-medium text-slate-600">{t.kubios.noHrvResults}</p>
      </div>
    )
  }

  const avgReadiness = averageOfChartKey(rows, 'readiness')
  const avgRmssd = averageOfChartKey(rows, 'rmssd')
  const avgHeartRate = averageOfChartKey(rows, 'heartRate')
  const lastRecords = t.kubios.charts.lastRecords.replace(
    '{count}',
    rows.length.toString(),
  )

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-xl bg-emerald-500 p-2.5">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {t.kubios.charts.averageReadiness}
              </h3>
              <p className="text-xs text-slate-600">{lastRecords}</p>
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900">
            {avgReadiness === null
              ? notAvailable
              : `${avgReadiness.toFixed(1)}%`}
          </p>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-xl bg-blue-500 p-2.5">
              <Heart className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {t.kubios.charts.averageRmssd}
              </h3>
              <p className="text-xs text-slate-600">
                {t.kubios.charts.heartRateVariability}
              </p>
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900">
            {avgRmssd === null ? notAvailable : `${avgRmssd.toFixed(1)} ms`}
          </p>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-xl bg-red-500 p-2.5">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {t.kubios.charts.averageHeartRate}
              </h3>
              <p className="text-xs text-slate-600">{t.kubios.charts.heartRate}</p>
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900">
            {avgHeartRate === null ? notAvailable : `${avgHeartRate.toFixed(0)} bpm`}
          </p>
        </div>
      </div>

      <HrvSection
        title={t.kubios.charts.readinessEvolution}
        results={results}
        yLabel={t.kubios.charts.readinessPercentage}
        domain={[0, 100]}
        lines={[
          {
            dataKey: 'readiness',
            name: t.kubios.charts.averageReadiness,
            color: HRV_METRIC_COLORS.readiness,
            unit: '%',
          },
        ]}
      />

      <HrvSection
        title={t.kubios.charts.rmssdEvolution}
        results={results}
        yLabel={t.kubios.charts.rmssdMs}
        lines={[
          {
            dataKey: 'rmssd',
            name: t.kubios.metrics.rmssd,
            color: HRV_METRIC_COLORS.rmssd,
            unit: 'ms',
          },
        ]}
      />

      <HrvSection
        title={t.kubios.charts.pnsSnsIndices}
        results={results}
        yLabel={t.kubios.charts.pnsSnsIndicesLabel}
        lines={[
          {
            dataKey: 'pnsIndex',
            name: t.kubios.charts.pnsIndex,
            color: HRV_METRIC_COLORS.pns,
            dashed: true,
          },
          {
            dataKey: 'snsIndex',
            name: t.kubios.charts.snsIndex,
            color: HRV_METRIC_COLORS.sns,
          },
        ]}
      />

      <HrvSection
        title={t.kubios.charts.heartRateRest}
        results={results}
        yLabel={t.kubios.charts.heartRateBpm}
        lines={[
          {
            dataKey: 'heartRate',
            name: t.kubios.charts.heartRateRestLabel,
            color: HRV_METRIC_COLORS.heartRate,
            unit: 'bpm',
          },
        ]}
      />

      <HrvSection
        title={t.kubios.charts.frequencyDomain}
        results={results}
        yLabel={t.kubios.charts.spectralPower}
        collapsedHeight={380}
        lines={[
          {
            dataKey: 'hfPower',
            name: t.kubios.charts.hfPower,
            color: HRV_METRIC_COLORS.hf,
            unit: 'ms²',
          },
          {
            dataKey: 'lfPower',
            name: t.kubios.charts.lfPower,
            color: HRV_METRIC_COLORS.lf,
            dashed: true,
            unit: 'ms²',
          },
          {
            dataKey: 'vlfPower',
            name: t.kubios.charts.vlfPower,
            color: HRV_METRIC_COLORS.vlf,
            dashed: true,
            unit: 'ms²',
          },
        ]}
      />
    </div>
  )
}
