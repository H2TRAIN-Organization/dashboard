'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useOptionalLanguage } from '@/contexts/LanguageContext'

interface StudyChartsProps {
  exerciseData: any[]
  moodData: any[]
}

interface CorrelationRow {
  date: string
  fullDate: string
  exerciseDuration: number
  moodValue: number
}

interface WeeklyRow {
  week: string
  exercise: number
  mood: number
  count: number
}

interface IntensityRow {
  name: string
  value: number
  color: string
}

const tooltipStyle = {
  backgroundColor: '#1f2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: 'white',
}

function readDate(record: any): Date | null {
  const value = record?.date || record?.date_time || record?.measured_timestamp
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function weekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1)
  return Math.ceil(
    ((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000) +
      start.getDay() +
      1) /
      7,
  )
}

export default function StudyCharts({ exerciseData, moodData }: StudyChartsProps) {
  const { t, language } = useOptionalLanguage()
  const locale = language === 'en' ? 'en-US' : 'es-ES'
  const notAvailable = t.common.notAvailable

  if (!exerciseData || exerciseData.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-lg text-slate-600">{t.study.noDataValue}</p>
      </div>
    )
  }

  const correlationData: CorrelationRow[] = exerciseData.map((exercise, index) => {
    const date = readDate(exercise)
    return {
      date: date
        ? date.toLocaleDateString(locale, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })
        : notAvailable,
      fullDate: date ? date.toISOString() : '',
      exerciseDuration: readNumber(exercise.duration),
      moodValue: readNumber(moodData[index]?.mood_value),
    }
  })

  const weeklyTrends = exerciseData.reduce<Record<string, WeeklyRow>>(
    (accumulator, exercise, index) => {
      const date = readDate(exercise)
      const weekKey = date
        ? `${date.getFullYear()}-${Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000))}`
        : 'unknown'
      if (accumulator[weekKey] === undefined) {
        accumulator[weekKey] = {
          week:
            weekKey === 'unknown' || date === null
              ? notAvailable
              : `${t.study.charts.week} ${weekNumber(date)}`,
          exercise: 0,
          mood: 0,
          count: 0,
        }
      }
      accumulator[weekKey].exercise += readNumber(exercise.duration)
      accumulator[weekKey].mood += readNumber(moodData[index]?.mood_value)
      accumulator[weekKey].count += 1
      return accumulator
    },
    {},
  )

  const weeklyData = Object.values(weeklyTrends).map((week) => ({
    ...week,
    exercise: week.count > 0 ? week.exercise / week.count : 0,
    mood: week.count > 0 ? week.mood / week.count : 0,
  }))

  const exerciseIntensity = exerciseData.reduce<Record<string, number>>(
    (accumulator, exercise) => {
      const intensity =
        typeof exercise.intensity === 'string' && exercise.intensity.trim().length > 0
          ? exercise.intensity
          : notAvailable
      accumulator[intensity] = (accumulator[intensity] || 0) + 1
      return accumulator
    },
    {},
  )

  const intensityData: IntensityRow[] = Object.entries(exerciseIntensity).map(
    ([intensity, count]) => ({
      name: intensity,
      value: count,
      color:
        intensity.toLowerCase() === 'bajo'
          ? '#10b981'
          : intensity.toLowerCase() === 'moderado'
            ? '#f59e0b'
            : '#ef4444',
    }),
  )

  const evolutionTitle =
    t.study.charts.evolutionTitle ||
    'Evolución Temporal: Ejercicio y Estado de Ánimo'
  const intensityTitle =
    t.study.charts.intensityTitle ||
    'Distribución de Intensidades de Ejercicio'
  const moodLabel = t.study.charts.mood || 'Estado de Ánimo'

  return (
    <div className="space-y-8">
      <div className="relative rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
        <h3 className="mb-6 flex items-center text-xl font-bold text-blue-600">
          <span className="mr-3 rounded-lg bg-gradient-to-br from-green-500 to-green-600 p-2">
            <LineChart className="h-5 w-5 text-white" />
          </span>
          {evolutionTitle}
        </h3>
        <p className="mb-6 text-sm text-gray-600">
          {t.study.charts.evolutionDescription}
          <strong className="text-green-700"> {t.study.charts.date}:</strong>{' '}
          {t.study.charts.date} |<strong className="text-green-700"> {t.study.charts.values}:</strong>{' '}
          {t.study.charts.duration} + {moodLabel}
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={correlationData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="date"
              stroke="#6b7280"
              fontSize={12}
              label={{
                value: t.study.charts.date,
                position: 'insideBottom',
                offset: -10,
                style: { textAnchor: 'middle', fill: '#6b7280' },
              }}
            />
            <YAxis
              stroke="#6b7280"
              fontSize={12}
              label={{
                value: t.study.charts.values,
                angle: -90,
                position: 'insideLeft',
                style: { textAnchor: 'middle', fill: '#6b7280' },
              }}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={{ color: 'white' }}
              labelStyle={{ color: 'white' }}
              formatter={(value, name) => [
                `${value}`,
                name === 'exerciseDuration'
                  ? t.study.charts.duration
                  : name === 'moodValue'
                    ? moodLabel
                    : name,
              ]}
              labelFormatter={(label) => `${t.study.charts.date}: ${label}`}
            />
            <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '14px', color: '#374151' }} />
            <Line
              type="monotone"
              dataKey="exerciseDuration"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
              name={t.study.charts.duration}
            />
            <Line
              type="monotone"
              dataKey="moodValue"
              stroke="#f59e0b"
              strokeWidth={3}
              dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }}
              name={moodLabel}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="relative rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
        <h3 className="mb-6 flex items-center text-xl font-bold text-blue-600">
          <span className="mr-3 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 p-2">
            <BarChart className="h-5 w-5 text-white" />
          </span>
          {t.study.charts.weeklyTitle}
        </h3>
        <p className="mb-6 text-sm text-gray-600">{t.study.charts.weeklyDescription}</p>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={weeklyData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
            <XAxis
              dataKey="week"
              stroke="#6b7280"
              fontSize={12}
              label={{
                value: t.study.charts.week,
                position: 'insideBottom',
                offset: -10,
                style: { textAnchor: 'middle', fill: '#6b7280' },
              }}
            />
            <YAxis
              stroke="#6b7280"
              fontSize={12}
              label={{
                value: t.study.charts.averageValues,
                angle: -90,
                position: 'insideLeft',
                style: { textAnchor: 'middle', fill: '#6b7280' },
              }}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={{ color: 'white' }}
              labelStyle={{ color: 'white' }}
              formatter={(value, name) => [
                `${Math.round(Number(value) * 100) / 100}`,
                name === 'exercise' ? t.study.charts.duration : moodLabel,
              ]}
              labelFormatter={(label) => `${t.study.charts.week}: ${label}`}
            />
            <Bar dataKey="exercise" fill="#10b981" name={t.study.charts.duration} radius={[4, 4, 0, 0]} />
            <Bar dataKey="mood" fill="#f59e0b" name={moodLabel} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="relative rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
        <h3 className="mb-6 flex items-center text-xl font-bold text-blue-600">
          <span className="mr-3 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 p-2">
            <PieChart className="h-5 w-5 text-white" />
          </span>
          {intensityTitle}
        </h3>
        <p className="mb-6 text-sm text-gray-600">{t.study.charts.intensityDescription}</p>
        <div className="flex items-center justify-center">
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={intensityData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                outerRadius={120}
                fill="#8884d8"
                dataKey="value"
              >
                {intensityData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={{ color: 'white' }}
                labelStyle={{ color: 'white' }}
                formatter={(value) => [`${value} ${t.study.charts.sessions}`, t.study.charts.sessions]}
                labelFormatter={(label) => `${t.study.charts.intensity}: ${label}`}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
