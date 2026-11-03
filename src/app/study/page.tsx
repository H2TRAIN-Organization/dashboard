'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  Activity,
  Heart,
  Brain,
  Zap,
  Target,
  BarChart3,
  PieChart,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Info,
  Filter
} from 'lucide-react'
import StudyCharts from '@/components/StudyCharts'
import { useKubiosMe, type KubiosMeView } from '@/hooks/useKubiosPersonal'
import { isKubiosPersonalVisible } from '@/lib/kubios-personal'

interface StudyData {
  // Datos de Supabase
  exerciseData: any[]
  glucoseData: any[]
  moodData: any[]
  insulinData: any[]
  mealData: any[]

  // Estadísticas calculadas
  correlations: {
    exerciseMood: number | null
  }

  insights: string[]
  recommendations: string[]
}

/**
 * Aviso honesto sobre Kubios. La vista de Estudio es colectiva para los datos
 * de diabetes, pero las métricas de Kubios son personales: solo se enlaza a
 * /kubios cuando la respuesta propia indica mediciones disponibles.
 */
export function StudyKubiosNotice({ view }: { view: KubiosMeView }) {
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
          <h3 className="text-2xl font-bold text-gray-900 mb-3">Kubios es personal</h3>
          <p className="text-gray-600 text-lg font-light">
            Las métricas de Kubios son personales y no se mezclan con los datos de
            este estudio colectivo. La vista personal de Kubios es el único lugar
            donde puedes consultar tus propias mediciones.
          </p>
          {hasPersonalMeasurements ? (
            <Link
              href="/kubios"
              className="mt-5 inline-flex items-center px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-700 hover:from-indigo-700 hover:to-blue-800 text-white font-semibold rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 shadow-lg hover:shadow-xl"
            >
              <Heart className="h-5 w-5 mr-2" />
              Ver mis métricas de Kubios
            </Link>
          ) : (
            <p className="mt-4 text-sm text-gray-500">
              Cuando tengas mediciones propias, podrás consultarlas en tu vista
              personal de Kubios.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function StudyPage() {
  const { t } = useLanguage()
  const { view: kubiosView } = useKubiosMe()
  const [studyData, setStudyData] = useState<StudyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('90')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchStudyData()
  }, [dateRange])

  const fetchStudyData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Datos colectivos de diabetes. Kubios no participa en esta consulta.
      const params = new URLSearchParams({
        selectedUser: 'all',
        timeRange: dateRange
      })

      const supabaseRes = await fetch(`/api/decrypted-data?${params}`)

      let supabaseData = { insulinData: [], foodData: [], exerciseData: [], periodData: [], moodData: [] }
      if (supabaseRes.ok) {
        supabaseData = await supabaseRes.json()
      }

      // Usar datos reales o generar datos de ejemplo si no hay suficientes
      const exerciseData = supabaseData.exerciseData.length > 0 ? supabaseData.exerciseData : generateSampleExerciseData(dateRange)
      const moodData = supabaseData.moodData.length > 0 ? supabaseData.moodData : generateSampleMoodData(dateRange)
      const insulinData = supabaseData.insulinData.length > 0 ? supabaseData.insulinData : generateSampleInsulinData(dateRange)
      const mealData = supabaseData.foodData.length > 0 ? supabaseData.foodData : generateSampleMealData(dateRange)

      // Calcular correlaciones y conclusiones solo con los datos disponibles.
      const correlations = calculateCorrelations(exerciseData, moodData)
      const insights = generateInsights(moodData, correlations)
      const recommendations = generateRecommendations(correlations, exerciseData, moodData)

      setStudyData({
        exerciseData,
        glucoseData: [], // No tenemos datos de glucosa
        moodData,
        insulinData,
        mealData,
        correlations,
        insights,
        recommendations
      })
    } catch {
      setError('Error al cargar datos del estudio')
    } finally {
      setLoading(false)
    }
  }

  // Fallback sintético preexistente del estudio de diabetes. K52 no lo
  // modifica porque está fuera de alcance; no se usa para Kubios.
  const generateSampleExerciseData = (range: string) => {
    const days = parseInt(range)
    const data: any[] = []

    for (let i = days; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)

      data.push({
        id: `exercise_${i}`,
        username: 'usuario_ejemplo',
        exercise_type: ['Caminar', 'Correr', 'Ciclismo', 'Natación', 'Pesas'][Math.floor(Math.random() * 5)],
        intensity: ['Bajo', 'Moderado', 'Alto'][Math.floor(Math.random() * 3)],
        exercise_start_time: '08:00',
        exercise_end_time: '09:00',
        exercise_description: 'Ejercicio de ejemplo',
        date_time: date.toISOString()
      })
    }
    return data
  }

  const generateSampleMoodData = (range: string) => {
    const days = parseInt(range)
    const data: any[] = []

    for (let i = days; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)

      data.push({
        id: `mood_${i}`,
        username: 'usuario_ejemplo',
        mood_value: Math.floor(Math.random() * 11), // 0-10
        out_of_routine: Math.random() > 0.7,
        routine_description: 'Rutina normal',
        emotions: ['Feliz', 'Tranquilo', 'Energético'][Math.floor(Math.random() * 3)],
        other_emotion: '',
        date_time: date.toISOString()
      })
    }
    return data
  }

  const generateSampleInsulinData = (range: string) => {
    const days = parseInt(range)
    const data: any[] = []

    for (let i = days; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)

      data.push({
        id: `insulin_${i}`,
        username: 'usuario_ejemplo',
        insulinType: ['Rápida', 'Lenta', 'Mixta'][Math.floor(Math.random() * 3)],
        dose: (Math.random() * 20 + 5).toFixed(1), // 5-25 unidades
        date_time: date.toISOString(),
        actualDateTime: date.toISOString()
      })
    }
    return data
  }

  const generateSampleMealData = (range: string) => {
    const days = parseInt(range)
    const data: any[] = []

    for (let i = days; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)

      data.push({
        id: `meal_${i}`,
        username: 'usuario_ejemplo',
        food_type: ['Desayuno', 'Almuerzo', 'Cena', 'Snack'][Math.floor(Math.random() * 4)],
        quantity: (Math.random() * 200 + 50).toFixed(0) + 'g',
        carbs: (Math.random() * 80 + 20).toFixed(0), // 20-100g
        date_time: date.toISOString()
      })
    }
    return data
  }

  const calculateCorrelations = (exercise: any[], mood: any[]) => {
    let exerciseMood = calculateCorrelation(exercise, mood, 'intensity', 'mood_value')
    if (exerciseMood === null) {
      exerciseMood = calculateCorrelation(exercise, mood, 'duration', 'mood_value')
    }

    return {
      exerciseMood:
        exerciseMood === null ? null : Math.round(exerciseMood * 100) / 100
    }
  }

  // Función para convertir campos de texto a números
  const convertToNumber = (value: any, field: string) => {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      // Convertir intensidad de ejercicio a número
      if (field === 'intensity') {
        switch (value.toLowerCase()) {
          case 'bajo': return 1
          case 'moderado': return 2
          case 'alto': return 3
          default: return 1
        }
      }
      // Convertir dosis de insulina a número
      if (field === 'dose') {
        const num = parseFloat(value)
        return isNaN(num) ? 0 : num
      }
      // Convertir otros campos string a número
      const num = parseFloat(value)
      return isNaN(num) ? 0 : num
    }
    return 0
  }

  const calculateCorrelation = (data1: any[], data2: any[], field1: string, field2: string) => {
    if (data1.length === 0 || data2.length === 0) return null

    // Función para obtener valor anidado
    const getNestedValue = (obj: any, field: string) => {
      if (field.includes('.')) {
        const parts = field.split('.')
        let value = obj
        for (const part of parts) {
          value = value?.[part]
        }
        return value
      }
      return obj[field]
    }

    // Buscar pares por fecha en lugar de por índice
    const pairs: number[][] = []

    data1.forEach(item1 => {
      const date1 = new Date(item1.date || item1.date_time || item1.measured_timestamp).toDateString()
      const val1 = convertToNumber(getNestedValue(item1, field1), field1)

      data2.forEach(item2 => {
        const date2 = new Date(item2.date || item2.date_time || item2.measured_timestamp).toDateString()
        const val2 = convertToNumber(getNestedValue(item2, field2), field2)

        if (date1 === date2 && (val1 !== 0 || val2 !== 0)) {
          pairs.push([val1, val2])
        }
      })
    })

    // Si no hay suficientes pares por fecha exacta, intentar con fechas cercanas
    if (pairs.length < 2) {
      data1.forEach(item1 => {
        const date1 = new Date(item1.date || item1.date_time || item1.measured_timestamp)
        const val1 = convertToNumber(getNestedValue(item1, field1), field1)

        data2.forEach(item2 => {
          const date2 = new Date(item2.date || item2.date_time || item2.measured_timestamp)
          const val2 = convertToNumber(getNestedValue(item2, field2), field2)

          const diffDays = Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24)

          if (diffDays <= 1 && (val1 !== 0 || val2 !== 0)) {
            pairs.push([val1, val2])
          }
        })
      })
    }

    if (pairs.length < 2) return null

    // Calcular correlación de Pearson
    const n = pairs.length
    const sum1 = pairs.reduce((sum, pair) => sum + (pair[0] ?? 0), 0)
    const sum2 = pairs.reduce((sum, pair) => sum + (pair[1] ?? 0), 0)
    const sum1Sq = pairs.reduce((sum, pair) => sum + (pair[0] ?? 0) ** 2, 0)
    const sum2Sq = pairs.reduce((sum, pair) => sum + (pair[1] ?? 0) ** 2, 0)
    const pSum = pairs.reduce((sum, pair) => sum + (pair[0] ?? 0) * (pair[1] ?? 0), 0)

    const num = pSum - (sum1 * sum2 / n)
    const den = Math.sqrt((sum1Sq - sum1 * sum1 / n) * (sum2Sq - sum2 * sum2 / n))

    return den === 0 ? null : num / den
  }

  const generateInsights = (mood: any[], correlations: { exerciseMood: number | null }) => {
    const insights: string[] = []

    if (correlations.exerciseMood !== null) {
      if (correlations.exerciseMood > 0.2) {
        insights.push("😊 El ejercicio regular mejora el estado de ánimo")
      } else if (correlations.exerciseMood < -0.2) {
        insights.push("😔 Ejercicio intenso puede estar afectando el estado de ánimo")
      } else {
        insights.push("💪 Ejercicio y estado de ánimo tienen relación estable")
      }
    }

    if (mood.length > 0) {
      const avgMood = mood.reduce((sum, m) => sum + (m.mood_value || 0), 0) / mood.length
      if (avgMood > 7) {
        insights.push("😊 Estado de ánimo general muy positivo")
      } else if (avgMood < 4) {
        insights.push("😔 Estado de ánimo general necesita atención")
      }
    }

    // Si no hay datos suficientes, no inventar conclusiones.
    if (insights.length === 0) {
      insights.push("📊 No hay datos suficientes para generar conclusiones del estudio")
    }

    return insights
  }

  const generateRecommendations = (
    correlations: { exerciseMood: number | null },
    exercise: any[],
    mood: any[]
  ) => {
    const recommendations: string[] = []

    if (correlations.exerciseMood !== null) {
      if (correlations.exerciseMood > 0.2) {
        recommendations.push("💪 Continuar con el ejercicio para mantener buen estado de ánimo")
      } else if (correlations.exerciseMood < -0.2) {
        recommendations.push("🧘‍♀️ Incorporar ejercicios de relajación y meditación")
      } else {
        recommendations.push("🎯 Variar tipos de ejercicio para optimizar bienestar")
      }
    }

    if (exercise.length > 0) {
      recommendations.push("📊 Monitorear patrones semanales para identificar tendencias")
    }

    if (mood.length > 0) {
      const avgMood = mood.reduce((sum, m) => sum + (m.mood_value || 0), 0) / mood.length
      if (avgMood < 5) {
        recommendations.push("🌅 Incorporar actividades matutinas para mejorar estado de ánimo")
      }
    }

    recommendations.push("📱 Registrar datos diariamente para mejor análisis")

    return recommendations
  }

  const exerciseMoodValue = studyData?.correlations.exerciseMood ?? null
  const exerciseMoodLabel =
    exerciseMoodValue === null
      ? 'Sin datos'
      : `${exerciseMoodValue > 0 ? '+' : ''}${exerciseMoodValue}`
  const exerciseMoodPercentage =
    exerciseMoodValue === null ? 0 : Math.abs(exerciseMoodValue * 100)
  const exerciseMoodPositive = exerciseMoodValue !== null && exerciseMoodValue > 0

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-white relative overflow-hidden">

          <Navigation title="Estudio Diabetes & Bienestar" />

        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
                <div className="relative bg-white border border-gray-200 rounded-2xl p-8 shadow-lg">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-400 mx-auto mb-4"></div>
                  <h3 className="text-xl font-bold text-blue-600 mb-2">{t.dashboard.analyzingStudyData}</h3>
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
      <div className="min-h-screen bg-white relative overflow-hidden">

        <Navigation title="Estudio Diabetes & Bienestar" />

        <div className="container mx-auto px-6 py-8">
          <div className="relative bg-gradient-to-br from-red-500/20 to-red-600/20 backdrop-blur-sm border border-red-400/30 rounded-2xl p-8">
            <div className="flex items-center mb-4">
              <div className="p-3 bg-gradient-to-br from-red-500 to-red-600 rounded-xl mr-4">
                <AlertTriangle className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white">Error en el Estudio</h3>
            </div>
            <p className="text-white/90 mb-4">{error}</p>
            <button
              onClick={fetchStudyData}
              className="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold rounded-xl hover:from-red-600 hover:to-red-700 transition-all duration-300 transform hover:scale-105"
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden">
        {/* Elementos decorativos de fondo */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-1000"></div>
          <div className="absolute top-40 left-1/2 w-80 h-80 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-500"></div>
        </div>

        <Navigation title="Estudio Diabetes & Bienestar" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
        {/* Header */}
        <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-10 mb-12 shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center">
              <div className="p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl mr-6 shadow-lg">
                <Brain className="h-12 w-12 text-white" />
              </div>
              <div>
                <h1 className="text-4xl md:text-5xl font-bold text-gray-900">
                  Estudio Diabetes & Bienestar
                </h1>
                <p className="text-gray-600 text-xl font-light mt-3">
                  Análisis de correlaciones entre actividad física, estado de ánimo y datos de diabetes
                </p>
              </div>
            </div>
            <div className="flex space-x-4">
              <button
                onClick={fetchStudyData}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 shadow-lg hover:shadow-xl"
              >
                <Zap className="h-6 w-6 inline mr-3" />
                Actualizar Análisis
              </button>
            </div>
          </div>
        </div>

        <StudyKubiosNotice view={kubiosView} />

        {/* Filtros */}
        <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-10 mb-12 shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
          <div className="relative z-10">
            <h3 className="text-2xl font-bold text-gray-900 mb-8 flex items-center">
              <div className="p-3 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl mr-4 shadow-lg">
                <Filter className="h-6 w-6 text-white" />
            </div>
            Filtros del Estudio
          </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-4 flex items-center">
                <Calendar className="h-5 w-5 mr-3 text-blue-600" />
                Período de Análisis
              </label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="w-full p-4 bg-white/50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:bg-white/70 transition-all duration-300 shadow-lg"
              >
                <option value="7">Últimos 7 días</option>
                <option value="30">Últimos 30 días</option>
                <option value="90">Últimos 3 meses</option>
                <option value="365">Último año</option>
              </select>
            </div>
              <div className="flex items-end space-x-4">
              <button
                  onClick={fetchStudyData}
                  className="flex-1 px-6 py-4 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 shadow-lg hover:shadow-xl flex items-center justify-center"
                >
                  <Zap className="h-5 w-5 mr-3" />
                  Analizar
                </button>
              </div>
            </div>
          </div>
        </div>

        {studyData && (
          <>
            {/* Correlación de bienestar */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-center justify-between mb-6">
                  <div className="p-4 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl shadow-lg">
                    <Activity className="h-8 w-8 text-white" />
                  </div>
                  <span className={`text-2xl font-bold ${exerciseMoodValue === null ? 'text-gray-500' : exerciseMoodPositive ? 'text-green-600' : 'text-red-600'}`}>
                    {exerciseMoodLabel}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Ejercicio ↔ Estado de Ánimo</h3>
                <p className="text-gray-600 text-lg font-light">
                  Impacto del ejercicio en el bienestar emocional
                </p>
                {exerciseMoodValue === null && (
                  <p className="text-gray-500 text-sm mt-4">
                    No hay datos suficientes para calcular esta correlación.
                  </p>
                )}
              </div>
            </div>

            {/* Insights y Recomendaciones */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:-translate-y-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-8 flex items-center">
                  <div className="p-3 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl mr-4 shadow-lg">
                    <Info className="h-6 w-6 text-white" />
                  </div>
                  Insights del Estudio
                </h3>
                <div className="space-y-4">
                  {studyData.insights.map((insight, index) => (
                    <div key={index} className="flex items-start p-6 bg-gradient-to-r from-yellow-50 to-yellow-100 rounded-2xl border border-yellow-200 shadow-lg">
                      <CheckCircle className="h-6 w-6 text-yellow-600 mt-1 mr-4 flex-shrink-0" />
                      <p className="text-gray-700 text-lg font-light">{insight}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:-translate-y-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-8 flex items-center">
                  <div className="p-3 bg-gradient-to-br from-green-500 to-green-600 rounded-xl mr-4 shadow-lg">
                    <Target className="h-6 w-6 text-white" />
                  </div>
                  Recomendaciones
                </h3>
                <div className="space-y-4">
                  {studyData.recommendations.map((recommendation, index) => (
                    <div key={index} className="flex items-start p-6 bg-gradient-to-r from-green-50 to-green-100 rounded-2xl border border-green-200 shadow-lg">
                      <Zap className="h-6 w-6 text-green-600 mt-1 mr-4 flex-shrink-0" />
                      <p className="text-gray-700 text-lg font-light">{recommendation}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Resumen de Datos Cargados */}
            <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-10 shadow-2xl">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
              <div className="relative z-10">
                <h2 className="text-3xl font-bold text-gray-900 mb-8 flex items-center">
                  <div className="p-3 bg-gradient-to-br from-green-500 to-green-600 rounded-xl mr-4 shadow-lg">
                    <Activity className="h-8 w-8 text-white" />
                  </div>
                  Resumen de Datos
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="text-center p-6 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl shadow-lg">
                    <div className="text-3xl font-bold text-blue-600">{studyData.exerciseData.length}</div>
                    <div className="text-lg text-gray-600 font-light">Registros de Ejercicio</div>
                  </div>
                  <div className="text-center p-6 bg-gradient-to-br from-green-50 to-green-100 rounded-2xl shadow-lg">
                    <div className="text-3xl font-bold text-green-600">{studyData.mealData.length}</div>
                    <div className="text-lg text-gray-600 font-light">Registros de Comidas</div>
                  </div>
                  <div className="text-center p-6 bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-2xl shadow-lg">
                    <div className="text-3xl font-bold text-yellow-600">{studyData.moodData.length}</div>
                    <div className="text-lg text-gray-600 font-light">Registros de Estado de Ánimo</div>
                  </div>
                  <div className="text-center p-6 bg-gradient-to-br from-red-50 to-red-100 rounded-2xl shadow-lg">
                    <div className="text-3xl font-bold text-red-600">{studyData.insulinData.length}</div>
                    <div className="text-lg text-gray-600 font-light">Registros de Insulina</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Gráficos de Análisis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
              {/* Correlación Ejercicio ↔ Estado de Ánimo */}
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:-translate-y-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-8 flex items-center">
                  <div className="p-3 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl mr-4 shadow-lg">
                    <PieChart className="h-6 w-6 text-white" />
                  </div>
                  Correlación Ejercicio ↔ Estado de Ánimo
                </h3>
                <div className="space-y-4">
                  {exerciseMoodValue === null ? (
                    <div className="p-6 bg-gray-50 rounded-2xl shadow-lg">
                      <p className="text-gray-600 text-lg font-light">
                        No hay datos suficientes para calcular una correlación entre
                        ejercicio y estado de ánimo.
                      </p>
                    </div>
                  ) : (
                    <div className="p-6 bg-gray-50 rounded-2xl shadow-lg">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-gray-700 font-semibold text-lg">
                          Ejercicio ↔ Estado de Ánimo
                        </span>
                        <span className={`text-xl font-bold ${exerciseMoodPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {exerciseMoodLabel}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                          className={`h-3 rounded-full bg-gradient-to-r ${exerciseMoodPositive ? 'from-green-500 to-green-600' : 'from-red-500 to-red-600'}`}
                          style={{ width: `${exerciseMoodPercentage}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Resumen de Datos */}
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:-translate-y-1">
                <h3 className="text-2xl font-bold text-gray-900 mb-8 flex items-center">
                  <div className="p-3 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl mr-4 shadow-lg">
                    <BarChart3 className="h-6 w-6 text-white" />
                  </div>
                  Resumen de Datos
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-6 bg-gradient-to-r from-blue-50 to-blue-100 rounded-2xl border border-blue-200 shadow-lg">
                    <span className="text-gray-700 text-lg font-semibold">Registros de Ejercicio</span>
                    <span className="text-blue-600 font-bold text-xl">{studyData.exerciseData.length}</span>
                  </div>
                  <div className="flex justify-between items-center p-6 bg-gradient-to-r from-orange-50 to-orange-100 rounded-2xl border border-orange-200 shadow-lg">
                    <span className="text-gray-700 text-lg font-semibold">Registros de Comidas</span>
                    <span className="text-orange-600 font-bold text-xl">{studyData.mealData.length}</span>
                  </div>
                  <div className="flex justify-between items-center p-6 bg-gradient-to-r from-pink-50 to-pink-100 rounded-2xl border border-pink-200 shadow-lg">
                    <span className="text-gray-700 text-lg font-semibold">Registros de Estado de Ánimo</span>
                    <span className="text-pink-600 font-bold text-xl">{studyData.moodData.length}</span>
                  </div>
                  <div className="flex justify-between items-center p-6 bg-gradient-to-r from-yellow-50 to-yellow-100 rounded-2xl border border-yellow-200 shadow-lg">
                    <span className="text-gray-700 text-lg font-semibold">Registros de Insulina</span>
                    <span className="text-yellow-600 font-bold text-xl">{studyData.insulinData.length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Gráficos de Análisis Avanzado */}
            <div className="mt-12">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-10 mb-12 shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
                <div className="relative z-10">
                  <h3 className="text-3xl font-bold text-gray-900 mb-8 flex items-center">
                    <div className="p-4 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-2xl mr-6 shadow-lg">
                      <BarChart3 className="h-8 w-8 text-white" />
                  </div>
                  Análisis Visual Avanzado
                </h3>
                  <p className="text-gray-600 text-xl font-light mb-8">
                  Gráficos especializados para el estudio de la relación entre diabetes, ejercicio y estado de ánimo
                </p>
                </div>
              </div>

              <StudyCharts
                exerciseData={studyData.exerciseData}
                moodData={studyData.moodData}
              />
            </div>
          </>
        )}
      </div>
    </div>
    </ProtectedRoute>
  )
}
