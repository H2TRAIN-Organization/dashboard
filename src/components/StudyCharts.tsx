'use client'

/**
 * Gráficos del estudio por participante. Cada métrica se dibuja en su propio
 * gráfico: ejercicio (minutos) y ánimo son escalas distintas, y combinarlas
 * en el mismo par de ejes es el anti-patrón "dual-axis correlation theatre".
 * Los valores ausentes quedan como huecos (`null`), nunca como ceros.
 */

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useOptionalLanguage } from '@/contexts/LanguageContext'
import { studyAdminDictionary } from '@/lib/study-admin-dictionary'
import type { StudyDay } from '@/lib/study-normalization'
import {
  CHART_AXIS_LABEL_STYLE,
  CHART_AXIS_LINE_STYLE,
  CHART_GRID_DASH,
  CHART_GRID_STROKE,
  CHART_PRIMARY_COLOR,
  CHART_SERIES_COLORS,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
} from '@/components/analytics/chart-theme'

const CHART_HEIGHT = 220

interface ParticipantMetricChartProps {
  rows: StudyDay[]
  /** Campo de StudyDay dibujado por la línea. */
  dataKey: 'exerciseDuration' | 'moodValue'
  name: string
  yLabel: string
  color: string
  ariaLabel: string
}

/**
 * Un gráfico por métrica y participante, con la presentación compartida del
 * dashboard (tokens de tema) y leyenda embebida en el tooltip.
 */
function ParticipantMetricChart({ rows, dataKey, name, yLabel, color, ariaLabel }: ParticipantMetricChartProps) {
  return (
    <div role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={rows} margin={{ top: 10, right: 15, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
          <XAxis
            dataKey="day"
            stroke={CHART_AXIS_LINE_STYLE.stroke}
            tick={CHART_TICK_STYLE}
            tickMargin={6}
          />
          <YAxis
            stroke={CHART_AXIS_LINE_STYLE.stroke}
            tick={CHART_TICK_STYLE}
            tickMargin={6}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            name={name}
            stroke={color}
            strokeWidth={2}
            connectNulls={false}
            dot={{ r: 3, strokeWidth: 1 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function StudyCharts({ days }: { days: readonly StudyDay[] }) {
  const { language } = useOptionalLanguage()
  const text = studyAdminDictionary[language === 'en' ? 'en' : 'es']
  if (!days.length) return <p>{text.empty}</p>

  const persons = [...new Set(days.map((day) => day.person))]
  return (
    <div className="space-y-6">
      {persons.map((person, index) => {
        const rows = days.filter((day) => day.person === person)
        return (
          <section key={person} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 font-semibold">{text.participant} {index + 1}</h3>
            <div className="space-y-4">
              <ParticipantMetricChart
                rows={rows}
                dataKey="exerciseDuration"
                name={text.exercise}
                yLabel={text.exercise}
                color={CHART_PRIMARY_COLOR}
                ariaLabel={`${text.exercise} · ${text.participant} ${index + 1}`}
              />
              <ParticipantMetricChart
                rows={rows}
                dataKey="moodValue"
                name={text.mood}
                yLabel={text.mood}
                color={CHART_SERIES_COLORS[1]}
                ariaLabel={`${text.mood} · ${text.participant} ${index + 1}`}
              />
            </div>
          </section>
        )
      })}
    </div>
  )
}
