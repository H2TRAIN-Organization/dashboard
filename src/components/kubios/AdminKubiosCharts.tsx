'use client'

/**
 * Charts for the participant selected in the admin Kubios view (MT42).
 *
 * Only the selected participant's own measurements are drawn; measurements
 * without a valid date are skipped and missing metrics leave gaps (`null`)
 * instead of being invented as zeros. Every chart is wrapped in the shared
 * scrollable container so dense series can be panned on both axes.
 *
 * MT69: every chart expands into an overlay and can narrow ONLY its own data
 * with a chart-scoped range, client-side over the measurements already
 * loaded (see src/lib/chart-scoped-filter.ts). The section hint keeps the
 * full window: closing the overlay leaves the rest of the page untouched.
 */

import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import ScrollableChart from '@/components/analytics/ScrollableChart'
import { HRV_METRIC_COLORS } from '@/components/analytics/chart-theme'
import {
  ChartExpandButton,
  ChartExpandOverlay,
  useChartExpand,
} from '@/components/analytics/chart-expand'
import { Select } from '@/components/ui/select'
import { lastDaysRange, recordsWithinRange } from '@/lib/chart-scoped-filter'
import HrvLineChart, { type ChartLine, type ChartRow } from './HrvLineChart'
import { parseKubiosDate } from '@/lib/kubios-personal'
import { buildHrvChartRows, type HrvMeasurementInput } from '@/lib/hrv-chart-rows'
import type { AdminKubiosMeasurement } from '@/app/admin/kubios/api'

/** Ancho interior por medición en los gráficos deslizables (MT42). */
const INNER_WIDTH_PER_MEASUREMENT = 80
const CHART_HEIGHT = 300
/** Altura del gráfico dentro del overlay expandido (MT69). */
const EXPANDED_CHART_HEIGHT = 520

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

/** Milisegundo de una medición; `null` cuando su fecha no es interpretable. */
function measurementTimestampOf(
  measurement: AdminKubiosMeasurement,
): number | null {
  const date = parseKubiosDate(measurement.measuredTimestamp)
  return date === null ? null : date.getTime()
}

/**
 * Tarjeta de un gráfico con expansión y filtro propio (MT69). El rango propio
 * solo estrecha las mediciones ya cargadas: sin filtro se dibujan las filas
 * completas (`rows`) y con filtro se reconstruyen solo dentro del rango.
 */
function ChartCard({
  title,
  yLabel,
  rows,
  measurements,
  lines,
  domain,
}: {
  title: string
  yLabel: string
  /** Filas completas de la serie ya construidas por el componente exportado. */
  rows: ChartRow[]
  /** Mediciones SIN filtrar: la tarjeta aplica su propio rango (MT69). */
  measurements: readonly AdminKubiosMeasurement[]
  lines: ChartLine[]
  domain?: [number, number]
}) {
  const { t, language } = useLanguage()
  const locale = language === 'en' ? 'en-US' : 'es-ES'
  const { open, expand, collapse } = useChartExpand()
  const [days, setDays] = useState<number | null>(null)

  // "Ahora" por render: el filtro propio solo estrecha lo ya cargado (MT69).
  const nowMs = new Date().getTime()
  const scopedRows =
    days === null
      ? rows
      : buildHrvChartRows(
          buildInputs(
            recordsWithinRange(
              measurements,
              lastDaysRange(days, nowMs),
              measurementTimestampOf,
            ),
          ),
          locale,
        )

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-bold text-slate-900 sm:text-base">{title}</h4>
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
          height={CHART_HEIGHT}
          minInnerWidth={scopedRows.length * INNER_WIDTH_PER_MEASUREMENT}
        >
          <HrvLineChart rows={scopedRows} lines={lines} yLabel={yLabel} domain={domain} />
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
            <HrvLineChart rows={scopedRows} lines={lines} yLabel={yLabel} domain={domain} />
          </ScrollableChart>
        )}
      />
    </>
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
          measurements={measurements}
          lines={[{ dataKey: 'readiness', name: t.kubios.charts.averageReadiness, color: HRV_METRIC_COLORS.readiness, unit: '%' }]}
          domain={[0, 100]}
        />
        <ChartCard
          title={t.kubios.charts.heartRateRest}
          yLabel={t.kubios.charts.heartRateBpm}
          rows={rows}
          measurements={measurements}
          lines={[{ dataKey: 'heartRate', name: t.kubios.charts.heartRateRestLabel, color: HRV_METRIC_COLORS.heartRate, unit: 'bpm' }]}
        />
        <ChartCard
          title={t.kubios.charts.rmssdEvolution}
          yLabel={t.kubios.charts.rmssdMs}
          rows={rows}
          measurements={measurements}
          lines={[{ dataKey: 'rmssd', name: t.kubios.metrics.rmssd, color: HRV_METRIC_COLORS.rmssd, unit: 'ms' }]}
        />
        <ChartCard
          title={t.kubios.charts.pnsSnsIndices}
          yLabel={t.kubios.charts.pnsSnsIndicesLabel}
          rows={rows}
          measurements={measurements}
          lines={[
            { dataKey: 'pnsIndex', name: t.kubios.charts.pnsIndex, color: HRV_METRIC_COLORS.pns, dashed: true },
            { dataKey: 'snsIndex', name: t.kubios.charts.snsIndex, color: HRV_METRIC_COLORS.sns },
          ]}
        />
        <ChartCard
          title={t.kubios.charts.frequencyDomain}
          yLabel={t.kubios.charts.spectralPower}
          rows={rows}
          measurements={measurements}
          lines={[
            { dataKey: 'hfPower', name: t.kubios.charts.hfPower, color: HRV_METRIC_COLORS.hf, unit: 'ms²' },
            { dataKey: 'lfPower', name: t.kubios.charts.lfPower, color: HRV_METRIC_COLORS.lf, dashed: true, unit: 'ms²' },
            { dataKey: 'vlfPower', name: t.kubios.charts.vlfPower, color: HRV_METRIC_COLORS.vlf, dashed: true, unit: 'ms²' },
          ]}
        />
      </div>
    </section>
  )
}
