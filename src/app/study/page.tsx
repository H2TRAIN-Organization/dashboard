'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage, useOptionalLanguage } from '@/contexts/LanguageContext'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  Calendar,
  CheckCircle,
  Filter,
  Heart,
  Info,
  Target,
  Zap,
} from 'lucide-react'
import StudyCharts from '@/components/StudyCharts'
import { useKubiosMe, type KubiosMeView } from '@/hooks/useKubiosPersonal'
import { isKubiosPersonalVisible } from '@/lib/kubios-personal'

interface StudyData {
  exerciseData: any[]
  glucoseData: any[]
  moodData: any[]
  insulinData: any[]
  mealData: any[]
  correlations: {
    exerciseMood: number | null
  }
  insights: StudyInsight[]
  recommendations: StudyRecommendation[]
}

type StudyInsight =
  | 'exerciseImproves'
  | 'intenseAffects'
  | 'stable'
  | 'moodPositive'
  | 'moodAttention'
  | 'noData'

type StudyRecommendation =
  | 'continueExercise'
  | 'relaxation'
  | 'varyExercise'
  | 'monitorWeekly'
  | 'morningActivities'
  | 'logDaily'

const INSIGHT_KEYS = {
  exerciseImproves: 'insightExerciseImproves',
  intenseAffects: 'insightIntenseAffects',
  stable: 'insightStable',
  moodPositive: 'insightMoodPositive',
  moodAttention: 'insightMoodAttention',
  noData: 'insightNoData',
} as const

const RECOMMENDATION_KEYS = {
  continueExercise: 'recommendationContinueExercise',
  relaxation: 'recommendationRelaxation',
  varyExercise: 'recommendationVaryExercise',
  monitorWeekly: 'recommendationMonitorWeekly',
  morningActivities: 'recommendationMorningActivities',
  logDaily: 'recommendationLogDaily',
} as const

/**
 * Aviso honesto sobre Kubios. La vista de Estudio es colectiva para los datos
 * de diabetes, pero las métricas de Kubios son personales: solo se enlaza a
 * /kubios cuando la respuesta propia indica mediciones disponibles.
 */
export function StudyKubiosNotice({ view }: { view: KubiosMeView }) {
  const { t } = useOptionalLanguage()
  const hasPersonalMeasurements =
    view.phase === 'data' &&
    view.data !== null &&
    isKubiosPersonalVisible(view.data.status, view.data.measurement_count)

  return (
    <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 mb-12 shadow-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-blue-600/5 rounded-3xl"></div>
      <div className="relative z-10 flex items-start gap-4">
        <div className="p-3 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-xl shadow-lg">
          <Heart className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-2xl font-bold text-gray-900 mb-3">
            {t.study.kubiosNoticeTitle}
          </h3>
          <p className="text-gray-600 text-lg font-light">
            {t.study.kubiosNoticeDescription}
          </p>
          {hasPersonalMeasurements ? (
            <Link
              href="/kubios"
              className="mt-5 inline-flex items-center px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-700 hover:from-indigo-700 hover:to-blue-800 text-white font-semibold rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 shadow-lg hover:shadow-xl"
            >
              <Heart className="h-5 w-5 mr-2" />
              {t.study.viewKubiosMetrics}
            </Link>
          ) : (
            <p className="mt-4 text-sm text-gray-500">{t.study.kubiosPending}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function toArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function numericValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function convertToNumber(value: unknown, field: string): number {
  if (field === 'intensity' && typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'bajo':
        return 1
      case 'moderado':
        return 2
      case 'alto':
        return 3
      default:
        return 1
    }
  }
  return numericValue(value)
}

function nestedValue(record: any, field: string): unknown {
  if (!field.includes('.')) return record?.[field]
  return field.split('.').reduce<any>((value, part) => value?.[part], record)
}

function calculateCorrelation(
  data1: any[],
  data2: any[],
  field1: string,
  field2: string,
): number | null {
  if (data1.length === 0 || data2.length === 0) return null

  const pairs: number[][] = []

  data1.forEach((item1) => {
    const date1 = new Date(item1.date || item1.date_time || item1.measured_timestamp).toDateString()
    const value1 = convertToNumber(nestedValue(item1, field1), field1)

    data2.forEach((item2) => {
      const date2 = new Date(item2.date || item2.date_time || item2.measured_timestamp).toDateString()
      const value2 = convertToNumber(nestedValue(item2, field2), field2)

      if (date1 === date2 && (value1 !== 0 || value2 !== 0)) {
        pairs.push([value1, value2])
      }
    })
  })

  if (pairs.length < 2) {
    data1.forEach((item1) => {
      const date1 = new Date(item1.date || item1.date_time || item1.measured_timestamp)
      const value1 = convertToNumber(nestedValue(item1, field1), field1)

      data2.forEach((item2) => {
        const date2 = new Date(item2.date || item2.date_time || item2.measured_timestamp)
        const value2 = convertToNumber(nestedValue(item2, field2), field2)
        const diffDays = Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24)

        if (diffDays <= 1 && (value1 !== 0 || value2 !== 0)) {
          pairs.push([value1, value2])
        }
      })
    })
  }

  if (pairs.length < 2) return null

  const n = pairs.length
  const sum1 = pairs.reduce((sum, pair) => sum + (pair[0] ?? 0), 0)
  const sum2 = pairs.reduce((sum, pair) => sum + (pair[1] ?? 0), 0)
  const sum1Sq = pairs.reduce((sum, pair) => sum + (pair[0] ?? 0) ** 2, 0)
  const sum2Sq = pairs.reduce((sum, pair) => sum + (pair[1] ?? 0) ** 2, 0)
  const productSum = pairs.reduce((sum, pair) => sum + (pair[0] ?? 0) * (pair[1] ?? 0), 0)

  const numerator = productSum - (sum1 * sum2) / n
  const denominator = Math.sqrt(
    (sum1Sq - (sum1 * sum1) / n) * (sum2Sq - (sum2 * sum2) / n),
  )

  return denominator === 0 ? null : numerator / denominator
}

function calculateCorrelations(exercise: any[], mood: any[]) {
  let exerciseMood = calculateCorrelation(exercise, mood, 'intensity', 'mood_value')
  if (exerciseMood === null) {
    exerciseMood = calculateCorrelation(exercise, mood, 'duration', 'mood_value')
  }

  return {
    exerciseMood:
      exerciseMood === null ? null : Math.round(exerciseMood * 100) / 100,
  }
}

function generateInsights(
  mood: any[],
  correlations: { exerciseMood: number | null },
): StudyInsight[] {
  const insights: StudyInsight[] = []

  if (correlations.exerciseMood !== null) {
    if (correlations.exerciseMood > 0.2) {
      insights.push('exerciseImproves')
    } else if (correlations.exerciseMood < -0.2) {
      insights.push('intenseAffects')
    } else {
      insights.push('stable')
    }
  }

  if (mood.length > 0) {
    const averageMood =
      mood.reduce((sum, item) => sum + numericValue(item.mood_value), 0) / mood.length
    if (averageMood > 7) {
      insights.push('moodPositive')
    } else if (averageMood < 4) {
      insights.push('moodAttention')
    }
  }

  if (insights.length === 0) {
    insights.push('noData')
  }

  return insights
}

function generateRecommendations(
  correlations: { exerciseMood: number | null },
  exercise: any[],
  mood: any[],
): StudyRecommendation[] {
  const recommendations: StudyRecommendation[] = []

  if (correlations.exerciseMood !== null) {
    if (correlations.exerciseMood > 0.2) {
      recommendations.push('continueExercise')
    } else if (correlations.exerciseMood < -0.2) {
      recommendations.push('relaxation')
    } else {
      recommendations.push('varyExercise')
    }
  }

  if (exercise.length > 0) {
    recommendations.push('monitorWeekly')
  }

  if (mood.length > 0) {
    const averageMood =
      mood.reduce((sum, item) => sum + numericValue(item.mood_value), 0) / mood.length
    if (averageMood < 5) {
      recommendations.push('morningActivities')
    }
  }

  recommendations.push('logDaily')
  return recommendations
}

export default function StudyPage() {
  const { t, language } = useLanguage()
  const { view: kubiosView } = useKubiosMe()
  const [studyData, setStudyData] = useState<StudyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('90')
  const [error, setError] = useState(false)

  const fetchStudyData = useCallback(async () => {
    try {
      setLoading(true)
      setError(false)

      // Datos colectivos de diabetes. Kubios no participa en esta consulta.
      const params = new URLSearchParams({
        selectedUser: 'all',
        timeRange: dateRange,
      })

      const supabaseRes = await fetch(`/api/decrypted-data?${params}`, { cache: 'no-store' })
      if (!supabaseRes.ok) {
        throw new Error('study-data')
      }

      const payload: unknown = await supabaseRes.json()
      const record =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>)
          : {}

      const exerciseData = toArray(record.exerciseData)
      const moodData = toArray(record.moodData)
      const insulinData = toArray(record.insulinData)
      const mealData = toArray(record.foodData)

      const correlations = calculateCorrelations(exerciseData, moodData)

      setStudyData({
        exerciseData,
        glucoseData: [],
        moodData,
        insulinData,
        mealData,
        correlations,
        insights: generateInsights(moodData, correlations),
        recommendations: generateRecommendations(correlations, exerciseData, moodData),
      })
    } catch {
      setStudyData(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [dateRange])

  useEffect(() => {
    void fetchStudyData()
  }, [fetchStudyData])

  const exerciseMoodValue = studyData?.correlations.exerciseMood ?? null
  const exerciseMoodLabel =
    exerciseMoodValue === null
      ? t.study.noDataValue
      : `${exerciseMoodValue > 0 ? '+' : ''}${exerciseMoodValue}`
  const exerciseMoodPercentage =
    exerciseMoodValue === null ? 0 : Math.abs(exerciseMoodValue * 100)
  const exerciseMoodPositive = exerciseMoodValue !== null && exerciseMoodValue > 0

  const hasStudyData = useMemo(() => {
    if (studyData === null) return false
    return (
      studyData.exerciseData.length +
        studyData.mealData.length +
        studyData.moodData.length +
        studyData.insulinData.length >
      0
    )
  }, [studyData])

  const hasInsights = useMemo(
    () =>
      studyData !== null &&
      studyData.insights.some((insight) => insight !== 'noData'),
    [studyData],
  )

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-white relative overflow-hidden">
          <Navigation title={t.study.pageTitle} />
          <div className="container mx-auto px-6 py-8">
            <div className="flex items-center justify-center min-h-[60vh]">
              <div className="text-center">
                <div className="relative bg-white border border-gray-200 rounded-2xl p-8 shadow-lg">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-400 mx-auto mb-4"></div>
                  <h3 className="text-xl font-bold text-blue-600 mb-2">
                    {t.dashboard.analyzingStudyData}
                  </h3>
                  <p className="text-gray-600">{t.dashboard.processingInfo}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  if (error) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-white relative overflow-hidden">
          <Navigation title={t.study.pageTitle} />
          <div className="container mx-auto px-6 py-8">
            <div className="relative rounded-2xl border border-red-300 bg-red-50 p-8">
              <div className="mb-4 flex items-center">
                <div className="mr-4 rounded-xl bg-gradient-to-br from-red-500 to-red-600 p-3">
                  <AlertTriangle className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-red-800">{t.study.errorTitle}</h3>
              </div>
              <p className="mb-4 text-red-700">{t.study.loadError}</p>
              <button
                type="button"
                onClick={() => void fetchStudyData()}
                className="rounded-xl bg-gradient-to-r from-red-500 to-red-600 px-6 py-3 font-semibold text-white transition-all duration-300 hover:from-red-600 hover:to-red-700"
              >
                {t.study.retry}
              </button>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-1000"></div>
          <div className="absolute top-40 left-1/2 w-80 h-80 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-500"></div>
        </div>

        <Navigation title={t.study.pageTitle} />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-6 sm:p-10 mb-12 shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center">
                <div className="mr-6 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-5 shadow-lg">
                  <Brain className="h-12 w-12 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl md:text-5xl font-bold text-gray-900">
                    {t.study.pageTitle}
                  </h1>
                  <p className="mt-3 text-lg font-light text-gray-600 sm:text-xl">
                    {t.study.pageSubtitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void fetchStudyData()}
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-6 py-4 font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 hover:shadow-xl"
              >
                <Zap className="mr-3 h-6 w-6" />
                {t.study.refreshAnalysis}
              </button>
            </div>
          </div>

          <StudyKubiosNotice view={kubiosView} />

          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-6 sm:p-10 mb-12 shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            <div className="relative z-10">
              <h2 className="mb-8 flex items-center text-2xl font-bold text-gray-900">
                <span className="mr-4 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 p-3 shadow-lg">
                  <Filter className="h-6 w-6 text-white" />
                </span>
                {t.study.filtersTitle}
              </h2>
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="study-range"
                    className="mb-4 flex items-center text-lg font-semibold text-gray-700"
                  >
                    <Calendar className="mr-3 h-5 w-5 text-blue-600" />
                    {t.study.analysisPeriod}
                  </label>
                  <select
                    id="study-range"
                    value={dateRange}
                    onChange={(event) => setDateRange(event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white/50 p-4 text-gray-900 shadow-lg transition-all duration-300 hover:bg-white/70 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="7">{t.data.last7Days}</option>
                    <option value="30">{t.data.last30Days}</option>
                    <option value="90">{t.study.last3Months}</option>
                    <option value="365">{t.study.lastYear}</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => void fetchStudyData()}
                    className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-6 py-4 font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 hover:shadow-xl"
                  >
                    <Zap className="mr-3 h-5 w-5" />
                    {t.study.analyze}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {studyData !== null && !hasStudyData && (
            <div className="relative bg-white/90 backdrop-blur-xl border border-slate-200 rounded-3xl p-10 shadow-2xl text-center">
              <BarChart3 className="mx-auto mb-4 h-12 w-12 text-slate-400" />
              <h2 className="text-2xl font-bold text-gray-900">{t.study.noStudyData}</h2>
              <p className="mx-auto mt-3 max-w-2xl text-gray-600">
                {t.study.noStudyDataDescription}
              </p>
            </div>
          )}

          {studyData !== null && hasStudyData && (
            <>
              <div className="mb-12 grid grid-cols-1 gap-8 md:grid-cols-2">
                {exerciseMoodValue !== null && (
                  <div className="relative rounded-3xl border border-gray-200/50 bg-white/90 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-3xl">
                    <div className="mb-6 flex items-center justify-between">
                      <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 p-4 shadow-lg">
                        <Activity className="h-8 w-8 text-white" />
                      </div>
                      <span
                        className={`text-2xl font-bold ${
                          exerciseMoodPositive ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {exerciseMoodLabel}
                      </span>
                    </div>
                    <h2 className="mb-3 text-xl font-bold text-gray-900">
                      {t.study.exerciseMoodTitle || 'Ejercicio ↔ Estado de Ánimo'}
                    </h2>
                    <p className="text-lg font-light text-gray-600">
                      {t.study.exerciseMoodDescription}
                    </p>
                  </div>
                )}
              </div>

              {exerciseMoodValue === null && (
                <div className="mb-8 rounded-2xl border border-slate-200 bg-white/80 px-6 py-4 text-sm font-medium text-slate-600 shadow-sm">
                  {t.study.insufficientCorrelation ||
                    'No hay datos suficientes para calcular esta correlación.'}
                </div>
              )}

              {hasInsights && (
                <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
                  <div className="relative rounded-3xl border border-gray-200/50 bg-white/90 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-3xl">
                    <h2 className="mb-8 flex items-center text-2xl font-bold text-gray-900">
                      <span className="mr-4 rounded-xl bg-gradient-to-br from-yellow-500 to-yellow-600 p-3 shadow-lg">
                        <Info className="h-6 w-6 text-white" />
                      </span>
                      {t.study.insightsTitle}
                    </h2>
                    <div className="space-y-4">
                      {studyData.insights.map((insight) => (
                        <div
                          key={insight}
                          className="flex items-start rounded-2xl border border-yellow-200 bg-gradient-to-r from-yellow-50 to-yellow-100 p-6 shadow-lg"
                        >
                          <CheckCircle className="mr-4 mt-1 h-6 w-6 flex-shrink-0 text-yellow-600" />
                          <p className="text-lg font-light text-gray-700">
                            {t.study[INSIGHT_KEYS[insight]]}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {studyData.recommendations.length > 0 && (
                    <div className="relative rounded-3xl border border-gray-200/50 bg-white/90 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-3xl">
                      <h2 className="mb-8 flex items-center text-2xl font-bold text-gray-900">
                        <span className="mr-4 rounded-xl bg-gradient-to-br from-green-500 to-green-600 p-3 shadow-lg">
                          <Target className="h-6 w-6 text-white" />
                        </span>
                        {t.study.recommendationsTitle}
                      </h2>
                      <div className="space-y-4">
                        {studyData.recommendations.map((recommendation) => (
                          <div
                            key={recommendation}
                            className="flex items-start rounded-2xl border border-green-200 bg-gradient-to-r from-green-50 to-green-100 p-6 shadow-lg"
                          >
                            <Zap className="mr-4 mt-1 h-6 w-6 flex-shrink-0 text-green-600" />
                            <p className="text-lg font-light text-gray-700">
                              {t.study[RECOMMENDATION_KEYS[recommendation]]}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!hasInsights && (
                <div className="mb-8 rounded-2xl border border-slate-200 bg-white/80 px-6 py-4 text-sm font-medium text-slate-600 shadow-sm">
                  {t.study.insightNoData ||
                    'No hay datos suficientes para generar conclusiones del estudio'}
                </div>
              )}

              <div className="relative mb-12 rounded-3xl border border-gray-200/50 bg-white/90 p-6 shadow-2xl backdrop-blur-xl sm:p-10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
                <div className="relative z-10">
                  <h2 className="mb-8 flex items-center text-3xl font-bold text-gray-900">
                    <span className="mr-4 rounded-xl bg-gradient-to-br from-green-500 to-green-600 p-3 shadow-lg">
                      <Activity className="h-8 w-8 text-white" />
                    </span>
                    {t.study.dataSummaryTitle}
                  </h2>
                  <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                    {studyData.exerciseData.length > 0 && (
                      <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 p-6 text-center shadow-lg">
                        <div className="text-3xl font-bold text-blue-600">
                          {studyData.exerciseData.length}
                        </div>
                        <div className="text-lg font-light text-gray-600">
                          {t.study.exerciseRecords}
                        </div>
                      </div>
                    )}
                    {studyData.mealData.length > 0 && (
                      <div className="rounded-2xl bg-gradient-to-br from-green-50 to-green-100 p-6 text-center shadow-lg">
                        <div className="text-3xl font-bold text-green-600">
                          {studyData.mealData.length}
                        </div>
                        <div className="text-lg font-light text-gray-600">
                          {t.study.mealRecords}
                        </div>
                      </div>
                    )}
                    {studyData.moodData.length > 0 && (
                      <div className="rounded-2xl bg-gradient-to-br from-yellow-50 to-yellow-100 p-6 text-center shadow-lg">
                        <div className="text-3xl font-bold text-yellow-600">
                          {studyData.moodData.length}
                        </div>
                        <div className="text-lg font-light text-gray-600">
                          {t.study.moodRecords}
                        </div>
                      </div>
                    )}
                    {studyData.insulinData.length > 0 && (
                      <div className="rounded-2xl bg-gradient-to-br from-red-50 to-red-100 p-6 text-center shadow-lg">
                        <div className="text-3xl font-bold text-red-600">
                          {studyData.insulinData.length}
                        </div>
                        <div className="text-lg font-light text-gray-600">
                          {t.study.insulinRecords}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {studyData.exerciseData.length > 0 && (
                <div className="mt-12">
                  <div className="relative mb-12 rounded-3xl border border-gray-200/50 bg-white/90 p-6 shadow-2xl backdrop-blur-xl sm:p-10">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
                    <div className="relative z-10">
                      <h2 className="mb-8 flex items-center text-3xl font-bold text-gray-900">
                        <span className="mr-6 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-600 p-4 shadow-lg">
                          <BarChart3 className="h-8 w-8 text-white" />
                        </span>
                        {t.study.advancedVisualTitle}
                      </h2>
                      <p className="mb-8 text-xl font-light text-gray-600">
                        {t.study.advancedVisualDescription}
                      </p>
                    </div>
                  </div>

                  <StudyCharts
                    exerciseData={studyData.exerciseData}
                    moodData={studyData.moodData}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
