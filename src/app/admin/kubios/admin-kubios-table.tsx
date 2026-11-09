'use client'

import {
  formatKubiosDate,
  formatKubiosMetric,
} from '@/lib/kubios-personal'
import { useLanguage } from '@/contexts/LanguageContext'
import type { AdminKubiosMeasurement } from './api'

interface AdminKubiosTableProps {
  measurements: readonly AdminKubiosMeasurement[]
}

const FREQUENCY_COLUMNS = [
  { key: 'HF_power', labelKey: 'hfPower' },
  { key: 'LF_power', labelKey: 'lfPower' },
  { key: 'VLF_power', labelKey: 'vlfPower' },
  { key: 'tot_power', labelKey: 'totalPower' },
] as const

const METRIC_COLUMNS = [
  { key: 'readiness', digits: 1 },
  { key: 'mean_hr_bpm', digits: 0 },
  { key: 'rmssd_ms', digits: 1 },
  { key: 'pns_index', digits: 2 },
  { key: 'sns_index', digits: 2 },
  { key: 'physiological_age', digits: 0 },
  { key: 'respiratory_rate', digits: 1 },
  { key: 'stress_index', digits: 1 },
] as const

export default function AdminKubiosTable({
  measurements,
}: AdminKubiosTableProps) {
  const { t, language } = useLanguage()
  const notAvailable = t.kubios.personal.notAvailable

  const metricLabels: Record<(typeof METRIC_COLUMNS)[number]['key'], string> = {
    readiness: t.admin.kubios.readiness,
    mean_hr_bpm: t.kubios.metrics.meanHr,
    rmssd_ms: t.kubios.metrics.rmssd,
    pns_index: t.kubios.metrics.pnsIndex,
    sns_index: t.kubios.metrics.snsIndex,
    physiological_age: t.kubios.metrics.physiologicalAge,
    respiratory_rate: t.kubios.metrics.respiratoryRate,
    stress_index: t.kubios.metrics.stressIndex,
  }

  const showFrequency = measurements.some((measurement) =>
    FREQUENCY_COLUMNS.some(
      ({ key }) => typeof measurement.metrics[key] === 'number',
    ),
  )

  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
        <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
          <caption className="sr-only">{t.admin.kubios.tableCaption}</caption>
          <thead className="bg-slate-100 text-[11px] uppercase tracking-wide text-slate-600">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[160px] bg-slate-100 px-3 py-3 font-bold"
              >
                {t.admin.kubios.participant}
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-bold">
                {t.admin.kubios.measuredAt}
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-bold">
                {t.admin.kubios.syncedAt}
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-bold">
                {t.admin.kubios.status}
              </th>
              {METRIC_COLUMNS.map(({ key }) => (
                <th
                  key={key}
                  scope="col"
                  className="whitespace-nowrap px-3 py-3 text-right font-bold"
                >
                  {metricLabels[key]}
                </th>
              ))}
              {showFrequency
                ? FREQUENCY_COLUMNS.map(({ key, labelKey }) => (
                    <th
                      key={key}
                      scope="col"
                      className="whitespace-nowrap px-3 py-3 text-right font-bold"
                    >
                      {t.kubios.metrics[labelKey]}
                    </th>
                  ))
                : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {measurements.map((measurement, index) => {
              const stale = measurement.status === 'stale'
              const measuredText = formatKubiosDate(
                measurement.measuredTimestamp,
                language,
                notAvailable,
              )
              const syncedText = formatKubiosDate(
                measurement.syncedAt,
                language,
                notAvailable,
              )
              return (
                <tr
                  key={`${measurement.userId}-${measurement.measuredTimestamp ?? 'sin-fecha'}-${index}`}
                  data-testid="admin-kubios-row"
                  className="align-top transition-colors hover:bg-blue-50/40"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 min-w-[160px] break-words bg-white px-3 py-3 font-semibold text-slate-900"
                  >
                    {measurement.username}
                  </th>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                    {measuredText}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                    {syncedText}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                        stale
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {stale
                        ? t.admin.kubios.statusStale
                        : t.admin.kubios.statusReady}
                    </span>
                  </td>
                  {METRIC_COLUMNS.map(({ key, digits }) => (
                    <td
                      key={key}
                      className="whitespace-nowrap px-3 py-3 text-right font-mono text-slate-800"
                    >
                      {formatKubiosMetric(
                        measurement.metrics[key],
                        digits,
                        notAvailable,
                      )}
                    </td>
                  ))}
                  {showFrequency
                    ? FREQUENCY_COLUMNS.map(({ key }) => (
                        <td
                          key={key}
                          className="whitespace-nowrap px-3 py-3 text-right font-mono text-slate-800"
                        >
                          {formatKubiosMetric(
                            measurement.metrics[key],
                            1,
                            notAvailable,
                          )}
                        </td>
                      ))
                    : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
