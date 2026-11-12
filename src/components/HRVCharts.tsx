'use client'

import { Activity, Heart, TrendingUp } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  parseKubiosDate,
  type KubiosLatestResult,
} from '@/lib/kubios-personal'
import ScrollableChart from '@/components/analytics/ScrollableChart'
import HrvLineChart, { type ChartRow } from './kubios/HrvLineChart'

interface HRVChartsProps {
  results: KubiosLatestResult[]
}

/** Ancho interior por medición en los gráficos deslizables de la vista personal. */
const INNER_WIDTH_PER_MEASUREMENT = 80
const DEFAULT_CHART_HEIGHT = 340

function numericMetric(
  metrics: Record<string, unknown>,
  key: string,
): number | null {
  const value = metrics[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null)
  if (valid.length === 0) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

/**
 * Gráficos de las mediciones propias. Las filas sin fecha válida no se pintan y
 * las métricas ausentes quedan como huecos (`null`); no se convierten en 0 ni se
 * rellenan con datos de ejemplo.
 */
export default function HRVCharts({ results }: HRVChartsProps) {
  const { t, language } = useLanguage()
  const locale = language === 'en' ? 'en-US' : 'es-ES'
  const notAvailable = t.kubios.personal.notAvailable

  const rows: ChartRow[] = []
  for (const result of results) {
    const date = parseKubiosDate(result.measured_timestamp)
    if (date === null) continue

    rows.push({
      time: date.getTime(),
      date: date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
      readiness: numericMetric(result.result, 'readiness'),
      rmssd: numericMetric(result.result, 'rmssd_ms'),
      pnsIndex: numericMetric(result.result, 'pns_index'),
      snsIndex: numericMetric(result.result, 'sns_index'),
      heartRate: numericMetric(result.result, 'mean_hr_bpm'),
      hfPower: numericMetric(
        typeof result.result.freq_domain === 'object' &&
          result.result.freq_domain !== null
          ? (result.result.freq_domain as Record<string, unknown>)
          : {},
        'HF_power',
      ),
      lfPower: numericMetric(
        typeof result.result.freq_domain === 'object' &&
          result.result.freq_domain !== null
          ? (result.result.freq_domain as Record<string, unknown>)
          : {},
        'LF_power',
      ),
      vlfPower: numericMetric(
        typeof result.result.freq_domain === 'object' &&
          result.result.freq_domain !== null
          ? (result.result.freq_domain as Record<string, unknown>)
          : {},
        'VLF_power',
      ),
    })
  }

  rows.sort((a, b) => a.time - b.time)

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm font-medium text-slate-600">{t.kubios.noHrvResults}</p>
      </div>
    )
  }

  const avgReadiness = average(rows.map((row) => row.readiness))
  const avgRmssd = average(rows.map((row) => row.rmssd))
  const avgHeartRate = average(rows.map((row) => row.heartRate))
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
                color: '#10B981',
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
                color: '#3B82F6',
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
                color: '#8B5CF6',
                dashed: true,
              },
              {
                dataKey: 'snsIndex',
                name: t.kubios.charts.snsIndex,
                color: '#F59E0B',
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
                color: '#EF4444',
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
            height={380}
            lines={[
              {
                dataKey: 'hfPower',
                name: t.kubios.charts.hfPower,
                color: '#06B6D4',
              },
              {
                dataKey: 'lfPower',
                name: t.kubios.charts.lfPower,
                color: '#8B5CF6',
                dashed: true,
              },
              {
                dataKey: 'vlfPower',
                name: t.kubios.charts.vlfPower,
                color: '#F97316',
                dashed: true,
              },
            ]}
          />
        </ScrollableChart>
      </div>
    </div>
  )
}
