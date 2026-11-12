'use client'

/**
 * Charts for the participant selected in the admin Kubios view (MT42).
 *
 * Only the selected participant's own measurements are drawn; measurements
 * without a valid date are skipped and missing metrics leave gaps (`null`)
 * instead of being invented as zeros. Every chart is wrapped in the shared
 * scrollable container so dense series can be panned on both axes.
 */

import { TrendingUp } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import ScrollableChart from '@/components/analytics/ScrollableChart'
import HrvLineChart, { type ChartLine, type ChartRow } from './HrvLineChart'
import { parseKubiosDate } from '@/lib/kubios-personal'
import { buildHrvChartRows, type HrvMeasurementInput } from '@/lib/hrv-chart-rows'
import type { AdminKubiosMeasurement } from '@/app/admin/kubios/api'

/** Ancho interior por medición en los gráficos deslizables (MT42). */
const INNER_WIDTH_PER_MEASUREMENT = 80
const CHART_HEIGHT = 300

function buildInputs(
  measurements: readonly AdminKubiosMeasurement[],
): HrvMeasurementInput[] {
  const inputs: HrvMeasurementInput[] = []
  for (const measurement of measurements) {
    const date = parseKubiosDate(measurement.measuredTimestamp)
    if (date === null) continue

    inputs.push({
      time: date.getTime(),
      metrics: { ...measurement.metrics },
    })
  }
  return inputs
}

function ChartCard({
  title,
  yLabel,
  rows,
  lines,
  domain,
}: {
  title: string
  yLabel: string
  rows: ChartRow[]
  lines: ChartLine[]
  domain?: [number, number]
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h4 className="mb-3 text-sm font-bold text-slate-900 sm:text-base">{title}</h4>
      <ScrollableChart
        height={CHART_HEIGHT}
        minInnerWidth={rows.length * INNER_WIDTH_PER_MEASUREMENT}
      >
        <HrvLineChart rows={rows} lines={lines} yLabel={yLabel} domain={domain} />
      </ScrollableChart>
    </div>
  )
}

export default function AdminKubiosCharts({
  measurements,
}: {
  measurements: readonly AdminKubiosMeasurement[]
}) {
  const { t, language } = useLanguage()
  const locale = language === 'en' ? 'en-US' : 'es-ES'

  const rows = buildHrvChartRows(buildInputs(measurements), locale)
  if (rows.length === 0) return null

  return (
    <section className="rounded-2xl border border-gray-200/60 bg-white/90 p-4 shadow-xl backdrop-blur-xl sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 p-2 shadow">
          <TrendingUp className="h-4 w-4 text-white" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900 sm:text-lg">
            {t.admin.kubios.chartsTitle}
          </h3>
          <p className="text-xs text-slate-600 sm:text-sm">
            {t.admin.kubios.chartsHint.replace('{count}', rows.length.toString())}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title={t.kubios.charts.readinessEvolution}
          yLabel={t.kubios.charts.readinessPercentage}
          rows={rows}
          lines={[{ dataKey: 'readiness', name: t.kubios.charts.averageReadiness, color: '#10B981', unit: '%' }]}
          domain={[0, 100]}
        />
        <ChartCard
          title={t.kubios.charts.heartRateRest}
          yLabel={t.kubios.charts.heartRateBpm}
          rows={rows}
          lines={[{ dataKey: 'heartRate', name: t.kubios.charts.heartRateRestLabel, color: '#EF4444', unit: 'bpm' }]}
        />
        <ChartCard
          title={t.kubios.charts.rmssdEvolution}
          yLabel={t.kubios.charts.rmssdMs}
          rows={rows}
          lines={[{ dataKey: 'rmssd', name: t.kubios.metrics.rmssd, color: '#3B82F6', unit: 'ms' }]}
        />
        <ChartCard
          title={t.kubios.charts.pnsSnsIndices}
          yLabel={t.kubios.charts.pnsSnsIndicesLabel}
          rows={rows}
          lines={[
            { dataKey: 'pnsIndex', name: t.kubios.charts.pnsIndex, color: '#8B5CF6', dashed: true },
            { dataKey: 'snsIndex', name: t.kubios.charts.snsIndex, color: '#F59E0B' },
          ]}
        />
        <ChartCard
          title={t.kubios.charts.frequencyDomain}
          yLabel={t.kubios.charts.spectralPower}
          rows={rows}
          lines={[
            { dataKey: 'hfPower', name: t.kubios.charts.hfPower, color: '#06B6D4', unit: 'ms²' },
            { dataKey: 'lfPower', name: t.kubios.charts.lfPower, color: '#8B5CF6', dashed: true, unit: 'ms²' },
            { dataKey: 'vlfPower', name: t.kubios.charts.vlfPower, color: '#F97316', dashed: true, unit: 'ms²' },
          ]}
        />
      </div>
    </section>
  )
}
