'use client'

import { Activity, Heart, TrendingUp } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  parseKubiosDate,
  type KubiosLatestResult,
} from '@/lib/kubios-personal'
import { buildHrvChartRows, averageOfChartKey, type HrvMeasurementInput } from '@/lib/hrv-chart-rows'
import ScrollableChart from '@/components/analytics/ScrollableChart'
import { HRV_METRIC_COLORS } from '@/components/analytics/chart-theme'
import HrvLineChart from './kubios/HrvLineChart'

interface HRVChartsProps {
  results: KubiosLatestResult[]
}

/** Ancho interior por medición en los gráficos deslizables de la vista personal. */
const INNER_WIDTH_PER_MEASUREMENT = 80
const DEFAULT_CHART_HEIGHT = 340

function frequencyMetrics(result: unknown): Record<string, unknown> {
  if (typeof result !== 'object' || result === null) return {}
  const freqDomain = (result as Record<string, unknown>).freq_domain
  if (typeof freqDomain !== 'object' || freqDomain === null) return {}
  return freqDomain as Record<string, unknown>
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

  const rows = buildHrvChartRows(inputs, locale)

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

      <div>
        <h3 className="mb-3 text-lg font-bold text-slate-900">
          {t.kubios.charts.readinessEvolution}
        </h3>
        <ScrollableChart height={DEFAULT_CHART_HEIGHT} minInnerWidth={rows.length * INNER_WIDTH_PER_MEASUREMENT}>
          <HrvLineChart
            rows={rows}
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
        </ScrollableChart>
      </div>

      <div>
        <h3 className="mb-3 text-lg font-bold text-slate-900">
          {t.kubios.charts.rmssdEvolution}
        </h3>
        <ScrollableChart height={DEFAULT_CHART_HEIGHT} minInnerWidth={rows.length * INNER_WIDTH_PER_MEASUREMENT}>
          <HrvLineChart
            rows={rows}
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
        </ScrollableChart>
      </div>

      <div>
        <h3 className="mb-3 text-lg font-bold text-slate-900">
          {t.kubios.charts.pnsSnsIndices}
        </h3>
        <ScrollableChart height={DEFAULT_CHART_HEIGHT} minInnerWidth={rows.length * INNER_WIDTH_PER_MEASUREMENT}>
          <HrvLineChart
            rows={rows}
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
        </ScrollableChart>
      </div>

      <div>
        <h3 className="mb-3 text-lg font-bold text-slate-900">
          {t.kubios.charts.heartRateRest}
        </h3>
        <ScrollableChart height={DEFAULT_CHART_HEIGHT} minInnerWidth={rows.length * INNER_WIDTH_PER_MEASUREMENT}>
          <HrvLineChart
            rows={rows}
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
        </ScrollableChart>
      </div>

      <div>
        <h3 className="mb-3 text-lg font-bold text-slate-900">
          {t.kubios.charts.frequencyDomain}
        </h3>
        <ScrollableChart height={380} minInnerWidth={rows.length * INNER_WIDTH_PER_MEASUREMENT}>
          <HrvLineChart
            rows={rows}
            yLabel={t.kubios.charts.spectralPower}
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
        </ScrollableChart>
      </div>
    </div>
  )
}
