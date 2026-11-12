'use client'

import { useState, useEffect, useCallback } from 'react'
import type { User, InsulinData, FoodData, ExerciseData, PeriodRecord, MoodData } from '@/lib/api-types'
import { dataApi, errorMessage, usersApi } from '@/lib/api-client'
import { getDisplayUsername } from '@/lib/user-mapper'
import { TrendingUp, Activity, Heart, Calendar, User as UserIcon, Filter, Pill, Utensils, Dumbbell, CalendarDays, Smile, Clock, BarChart3, LineChart as LineChartIcon, ChevronDown } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area } from 'recharts'
import ProtectedRoute from '@/components/ProtectedRoute'
import Navigation from '@/components/Navigation'
import StatCard from '@/components/analytics/StatCard'
import ScrollableChart from '@/components/analytics/ScrollableChart'
import PieSliceLabel from '@/components/analytics/PieSliceLabel'
import {
  CHART_AREA_FILL,
  CHART_AXIS_LABEL_STYLE,
  CHART_AXIS_LINE_STYLE,
  CHART_GRID_DASH,
  CHART_GRID_STROKE,
  CHART_OTHERS_COLOR,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  seriesColor,
} from '@/components/analytics/chart-theme'
import {
  aggregatePieTail,
  countByDate,
  countByField,
  countByLevel,
  mergeDailyCounts,
  sortByValueDescending,
  summarizeDosesByDate,
} from '@/lib/chart-grouping'
import { splitFoodRecords } from '@/lib/meal-classification'
import { finiteAverage, latestValidDate, parseFiniteNumber, parseFiniteNumberOrZero } from '@/lib/number-stats'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'

/** Tipos de insulina que se muestran individualmente antes de agrupar en "Otros". */
const INSULIN_TOP_TYPES = 5
/** Ancho interior por categoría en los gráficos de barras deslizables. */
const BAR_INNER_WIDTH_PER_ITEM = 80
/** Ancho interior por fecha en los gráficos de evolución temporal deslizables. */
const LINE_INNER_WIDTH_PER_ITEM = 80

export default function AnalyticsPage() {
  const { t, language } = useLanguage()
  const locale = language === 'en' ? 'en-US' : 'es-ES'
  const { session } = useSession()
  const [insulinData, setInsulinData] = useState<InsulinData[]>([])
  const [foodData, setFoodData] = useState<FoodData[]>([])
  const [exerciseData, setExerciseData] = useState<ExerciseData[]>([])
  const [periodData, setPeriodData] = useState<PeriodRecord[]>([])
  const [moodData, setMoodData] = useState<MoodData[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<string>('all')
  const [timeRange, setTimeRange] = useState<string>('30d')
  const [selectedDataType, setSelectedDataType] = useState<string>('all')
  const [insulinOthersOpen, setInsulinOthersOpen] = useState(false)

  const currentRole = session?.user.role ?? null
  const currentUsername = session?.user.username ?? null
  const isIndividualUser = currentRole === 'user'

  // MT38: la app móvil escribe eventos de glucemia (hipoglucemia/hiperglucemia)
  // en la tabla de comidas. No son comidas: se excluyen de las métricas y de
  // todos los gráficos de comidas y se avisa al usuario en el gráfico afectado.
  const { meals: mealData, glucoseEvents } = splitFoodRecords(foodData)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const selected = isIndividualUser ? (currentUsername ?? '') : selectedUser
      if (isIndividualUser && selected.length === 0) {
        throw new Error(t.auth.sessionMissingUsername)
      }

      const data = await dataApi.getDecrypted({
        selectedUser: selected,
        timeRange: timeRange as '7d' | '30d' | '90d' | 'all',
        selectedDataType: selectedDataType as 'all' | 'insulin' | 'food' | 'exercise' | 'period' | 'mood',
      })

      setInsulinData(data.insulinData)
      setFoodData(data.foodData)
      setExerciseData(data.exerciseData)
      setPeriodData(data.periodData)
      setMoodData(data.moodData)
    } catch (caught) {
      console.error('Error fetching data:', caught)
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [selectedUser, timeRange, selectedDataType, isIndividualUser, currentUsername, t.auth.sessionMissingUsername])

  const fetchUsers = useCallback(async () => {
    try {
      const result = await usersApi.listAll()
      setUsers(result.users)
    } catch (caught) {
      console.error('Error fetching users:', caught)
      setError(errorMessage(caught))
    }
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    const load = async () => {
      // Yield once so the effect body does not synchronously set state.
      await Promise.resolve()
      if (cancelled) return
      await Promise.all([fetchData(), fetchUsers()])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session, fetchData, fetchUsers])

  // Agrupación por fecha y por tipo delegada en la lib compartida: el orden es
  // cronológico real (clave = milisegundo de la fecha, MT38) y las etiquetas
  // localizadas se generan al final. Los registros con fecha inválida se
  // omiten.
  const dayLabelOf = (ms: number): string =>
    new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const timeOf = (value: string): number => new Date(String(value)).getTime()

  const insulinByDate = countByDate(insulinData, (row) => timeOf(row.date_time), dayLabelOf)
  const foodByDate = countByDate(mealData, (row) => timeOf(row.date_time), dayLabelOf)
  const exerciseByDate = countByDate(exerciseData, (row) => timeOf(row.date_time), dayLabelOf)
  const moodByDate = countByDate(moodData, (row) => timeOf(row.date_time), dayLabelOf)

  // Las barras por categoría se ordenan de mayor a menor para que el ranking
  // sea directo (anti-patrón: barras sin orden).
  const insulinByType = sortByValueDescending(
    countByField(insulinData, (row) => row.insulinType, t.common.noData),
  )
  const foodByType = sortByValueDescending(
    countByField(mealData, (row) => row.food_type, t.common.noData),
  )

  // Distribución de ánimo: escala ordinal completa 0..10 con ceros incluidos
  // (los niveles ausentes son parte de la respuesta, no desaparecen). Solo
  // valores numéricos participan; "Sin datos/10" no es un nivel.
  const moodLevels = countByLevel(
    moodData.flatMap((item) => {
      const level = parseFiniteNumber(item.mood_value)
      return level === null ? [] : [level]
    }),
    0,
    10,
  )
  const moodLevelsHaveData = moodLevels.some((entry) => entry.count > 0)

  // Estadísticas generales. Los promedios usan parseo tolerante: los campos
  // con texto vacío o no numérico no pueden convertir la media en NaN (MT41).
  const stats = {
    totalInsulin: insulinData.length,
    totalFood: mealData.length,
    totalExercise: exerciseData.length,
    totalPeriods: periodData.length,
    totalMood: moodData.length,
    totalRecords: insulinData.length + mealData.length + exerciseData.length + periodData.length + moodData.length,
    
    // Promedios de dosis de insulina
    avgInsulinDose: finiteAverage(insulinData.map(item => item.dose)) ?? 0,
    
    // Promedio de carbohidratos (solo comidas reales)
    avgCarbs: finiteAverage(mealData.map(item => item.carbs)) ?? 0,
    
    // Promedio de estado de ánimo
    avgMood: finiteAverage(moodData.map(item => item.mood_value)) ?? 0,
    
    // Última actividad: solo fechas válidas participan del máximo (MT41).
    lastActivity: null as Date | null
  }

  // Encontrar la actividad más reciente
  const allDates = [
    ...insulinData.map(d => new Date(d.date_time)),
    ...mealData.map(d => new Date(d.date_time)),
    ...exerciseData.map(d => new Date(d.date_time)),
    ...periodData.map(d => new Date(d.startDate)),
    ...moodData.map(d => new Date(d.date_time))
  ]

  stats.lastActivity = latestValidDate(allDates)

  const hasAnyData = stats.totalRecords > 0
  const showData = !loading && error === null && hasAnyData

  // Inyecciones y promedio de dosis reales por día; dos gráficos separados
  // para que cada título represente exactamente lo que dibuja. La clave de
  // día se genera a partir de la fecha ya parseada (MT38) y la dosis usa
  // parseo tolerante.
  const insulinDosesByDate = summarizeDosesByDate(
    insulinData,
    (row) => dayLabelOf(timeOf(row.date_time)),
    (row) => parseFiniteNumberOrZero(row.dose),
  )

  // Pie chart de insulina: los tipos menos representativos se agrupan en
  // "Otros" con el porcentaje sumado, con desglose disponible en desplegable.
  const insulinPie = aggregatePieTail(insulinByType, INSULIN_TOP_TYPES, t.analytics.others)
  const insulinPieData = insulinPie.others !== null
    ? [...insulinPie.slices, insulinPie.others]
    : insulinPie.slices
  const insulinTotal = insulinByType.reduce((total, entry) => total + entry.value, 0)

  // Datos combinados para el gráfico de actividad general: la fusión agrupa y
  // ordena por milisegundo, nunca por etiqueta localizada.
  const activityData = mergeDailyCounts([insulinByDate, foodByDate, exerciseByDate, moodByDate])
    .map((entry) => ({ date: entry.label, count: entry.count }))

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden">
        {/* Elementos decorativos de fondo */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-1000"></div>
          <div className="absolute top-40 left-1/2 w-80 h-80 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-500"></div>
        </div>
        
        <Navigation title={t.dashboard.advancedAnalytics} />

        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 lg:py-8 xl:py-12 relative z-10">
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}
          {/* Header - Oculto en móvil */}
          <div className="hidden sm:block relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-10 mb-6 sm:mb-12 overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-2xl sm:rounded-3xl"></div>
            
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 sm:mb-8 space-y-4 lg:space-y-0">
              <div className="flex flex-col sm:flex-row sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
                <div className="p-3 sm:p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl sm:rounded-2xl shadow-lg">
                  <BarChart3 className="h-8 w-8 sm:h-12 sm:w-12 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-gray-900 mb-1 sm:mb-2">
                    {t.dashboard.advancedAnalytics}
                  </h1>
                  <p className="text-gray-600 text-sm sm:text-base lg:text-xl font-light">{t.dashboard.advancedAnalyticsDescription}</p>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="flex items-center space-x-3 bg-white/80 backdrop-blur-sm border border-gray-200/50 px-4 sm:px-6 py-2 sm:py-3 rounded-xl shadow-lg">
                  <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
                  <div>
                    <div className="text-xs sm:text-sm text-gray-600">{t.analytics.records}</div>
                    <div className="text-lg sm:text-2xl font-bold text-gray-900">
                      {loading ? '…' : stats.totalRecords}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-10 mb-6 sm:mb-12 shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <div className="flex items-center">
                  <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg mr-2 sm:mr-3">
                    <Filter className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <h2 className="text-base sm:text-xl font-bold text-slate-800">{t.dashboard.dataFilters}</h2>
                </div>
              </div>
              
              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 ${isIndividualUser ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
                {!isIndividualUser && (
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center">
                      <UserIcon className="h-4 w-4 mr-2" />
                      {t.dashboard.user}
                    </label>
                    <select
                      value={selectedUser}
                      onChange={(e) => setSelectedUser(e.target.value)}
                      className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-700 shadow-lg hover:border-slate-400 transition-all duration-300 cursor-pointer appearance-none bg-gradient-to-r from-slate-50 to-blue-50"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                        backgroundPosition: 'right 12px center',
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '16px'
                      }}
                    >
                      <option value="all" className="bg-white text-slate-700 py-2">{t.dashboard.allUsers}</option>
                      {users.filter(user => user.Username.length > 0).map(user => (
                        <option key={user.UserID} value={user.Username} className="bg-white text-slate-700">
                          {getDisplayUsername(user)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center">
                    <Activity className="h-4 w-4 mr-2" />
                    {t.dashboard.dataType}
                  </label>
                  <select
                    value={selectedDataType}
                    onChange={(e) => setSelectedDataType(e.target.value)}
                    className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-700 shadow-lg hover:border-slate-400 transition-all duration-300 cursor-pointer appearance-none bg-gradient-to-r from-slate-50 to-blue-50"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 12px center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '16px'
                    }}
                  >
                    <option value="all" className="bg-white text-slate-700 py-2">{t.dashboard.allTypes}</option>
                    <option value="insulin" className="bg-white text-slate-700">{t.dashboard.insulin}</option>
                    <option value="food" className="bg-white text-slate-700">{t.dashboard.meals}</option>
                    <option value="exercise" className="bg-white text-slate-700">{t.dashboard.exercise}</option>
                    <option value="period" className="bg-white text-slate-700">{t.dashboard.periods}</option>
                    <option value="mood" className="bg-white text-slate-700">{t.dashboard.mood}</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center">
                    <Clock className="h-4 w-4 mr-2" />
                    {t.dashboard.timeRange}
                  </label>
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                    className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-700 shadow-lg hover:border-slate-400 transition-all duration-300 cursor-pointer appearance-none bg-gradient-to-r from-slate-50 to-blue-50"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 12px center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '16px'
                    }}
                  >
                    <option value="7d" className="bg-white text-slate-700 py-2">{t.data.last7Days}</option>
                    <option value="30d" className="bg-white text-slate-700">{t.data.last30Days}</option>
                    <option value="90d" className="bg-white text-slate-700">{t.data.last90Days}</option>
                    <option value="all" className="bg-white text-slate-700">{t.dashboard.allTime}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Estadísticas: una sola estructura de tarjeta, centrada en
              filas de 3 arriba / 2 abajo en escritorio (MT06). */}
          {showData && (
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6 mb-6 sm:mb-12">
            {insulinData.length > 0 && (
              <StatCard
                icon={Pill}
                iconGradient="from-blue-600 to-blue-700"
                accent="text-blue-600"
                title={t.dashboard.insulin}
                value={String(stats.totalInsulin)}
                description={`${t.analytics.average}: ${stats.avgInsulinDose} ${t.analytics.units}`}
              />
            )}

            {foodData.length > 0 && (
              <StatCard
                icon={Utensils}
                iconGradient="from-green-500 to-green-600"
                accent="text-green-600"
                title={t.dashboard.meals}
                value={String(stats.totalFood)}
                description={`${t.analytics.average}: ${stats.avgCarbs} ${t.analytics.carbohydrates}`}
              />
            )}

            {exerciseData.length > 0 && (
              <StatCard
                icon={Dumbbell}
                iconGradient="from-orange-500 to-orange-600"
                accent="text-orange-600"
                title={t.dashboard.exercise}
                value={String(stats.totalExercise)}
                description={t.analytics.registeredSessions}
              />
            )}

            <StatCard
              icon={Activity}
              iconGradient="from-indigo-500 to-indigo-600"
              accent="text-indigo-600"
              title={t.dashboard.total}
              value={String(stats.totalRecords)}
              description={t.analytics.allTypes}
            />

            {stats.lastActivity && (
              <StatCard
                icon={Calendar}
                iconGradient="from-red-500 to-red-600"
                accent="text-red-600"
                title={t.dashboard.lastActivity}
                value={new Date(stats.lastActivity).toLocaleDateString(locale)}
                description={t.analytics.mostRecentDate}
              />
            )}

            {periodData.length > 0 && (
              <StatCard
                icon={CalendarDays}
                iconGradient="from-purple-500 to-purple-600"
                accent="text-purple-600"
                title={t.dashboard.periods}
                value={String(stats.totalPeriods)}
                description={t.analytics.cycleRecords}
              />
            )}

            {moodData.length > 0 && (
              <StatCard
                icon={Smile}
                iconGradient="from-pink-500 to-pink-600"
                accent="text-pink-600"
                title={t.dashboard.mood}
                value={String(stats.totalMood)}
                description={`${t.analytics.average}: ${stats.avgMood}/10`}
              />
            )}
          </div>
          )}

          {!loading && error === null && !hasAnyData && (
            <div className="relative mb-6 rounded-2xl border border-slate-200 bg-white/90 p-10 text-center shadow-xl">
              <BarChart3 className="mx-auto mb-4 h-12 w-12 text-slate-400" />
              <h2 className="text-2xl font-bold text-gray-900">{t.overview.noDataTitle}</h2>
              <p className="mx-auto mt-3 max-w-2xl text-gray-600">{t.overview.noDataDescription}</p>
            </div>
          )}

          {/* Gráficos */}
          {loading ? (
            <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-12 text-center shadow-xl">
              <div className="flex items-center justify-center space-x-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <p className="text-slate-700 text-lg font-medium">{t.dashboard.loadingData}</p>
              </div>
            </div>
          ) : showData ? (
            <div className="space-y-8">
              {/* Gráfico de actividad general */}
              <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                
                <div className="relative z-10">
                  <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center">
                    <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg mr-3">
                      <LineChartIcon className="h-5 w-5 text-white" />
                    </div>
                    {t.analytics.generalActivityByDate}
                  </h3>
                  <ResponsiveContainer width="100%" height={400}>
                    <AreaChart data={activityData}>
                      <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="date" stroke={CHART_AXIS_LINE_STYLE.stroke} />
                      <YAxis stroke={CHART_AXIS_LINE_STYLE.stroke} />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                        itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                        labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                      />
                      <Area type="monotone" dataKey="count" stroke={CHART_AREA_FILL} fill="url(#activityGradient)" strokeWidth={2} />
                      <defs>
                        <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART_AREA_FILL} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={CHART_AREA_FILL} stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Gráficos por tipo de dato */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Insulina por tipo */}
                {insulinByType.length > 0 && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg mr-3">
                          <Pill className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.insulinTypesUsed}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsInsulinTypes} 
                        <strong className="text-blue-600"> {t.analytics.eachSector}:</strong> {t.analytics.percentageUsage}
                      </p>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={insulinPieData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={<PieSliceLabel />}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {insulinPieData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={index === insulinPieData.length - 1 && insulinPie.others !== null ? CHART_OTHERS_COLOR : seriesColor(index)}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                            formatter={(value) => [
                              `${value} ${t.analytics.injections}`,
                              t.analytics.insulinType
                            ]}
                            labelFormatter={(label) => `${t.analytics.type}: ${label}`}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      {insulinPie.others !== null && (
                        <div className="mt-2">
                          <button
                            type="button"
                            aria-expanded={insulinOthersOpen}
                            onClick={() => setInsulinOthersOpen((open) => !open)}
                            className="inline-flex items-center rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
                          >
                            <ChevronDown className={`h-4 w-4 mr-2 transition-transform ${insulinOthersOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                            {t.analytics.othersDetail} ({insulinPie.othersBreakdown.length})
                          </button>
                          {insulinOthersOpen && (
                            <ul className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white/80 p-3 sm:p-4">
                              {insulinPie.othersBreakdown.map((entry) => (
                                <li key={entry.name} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_OTHERS_COLOR }} aria-hidden="true"></span>
                                    <span className="truncate">{entry.name}</span>
                                  </span>
                                  <span className="font-semibold shrink-0">
                                    {insulinTotal > 0 ? `${((entry.value / insulinTotal) * 100).toFixed(1)}%` : '0%'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Comidas por tipo */}
                {foodByType.length > 0 && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg mr-3">
                          <Utensils className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.registeredMealTypes}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsMealTypes} 
                        <strong className="text-green-600"> {t.analytics.xAxis}:</strong> {t.analytics.mealTypes} | 
                        <strong className="text-green-600"> {t.analytics.yAxis}:</strong> {t.analytics.numberOfRecords}
                      </p>
                      {glucoseEvents.length > 0 && (
                        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                          {t.analytics.glucoseEventsExcluded.replace('{count}', String(glucoseEvents.length))}
                        </p>
                      )}
                      <ScrollableChart height={300} minInnerWidth={foodByType.length * BAR_INNER_WIDTH_PER_ITEM}>
                        <BarChart data={foodByType}>
                          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                          <XAxis 
                            dataKey="name" 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.mealTypes, position: 'insideBottom', offset: -5, style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <YAxis 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.numberOfRecords, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                          formatter={(value) => [
                              `${value} ${t.analytics.records}`,
                              t.analytics.mealType
                            ]}
                            labelFormatter={(label) => `${t.analytics.type}: ${label}`}
                          />
                          <Bar dataKey="value" fill="#10B981" name={t.analytics.registeredMeals} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ScrollableChart>
                    </div>
                  </div>
                )}

                {/* Inyecciones de insulina por día */}
                {insulinByDate.length > 0 && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg mr-3">
                          <Pill className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.injectionsPerDay}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsInsulinInjections} 
                        <strong className="text-blue-600"> {t.analytics.xAxis}:</strong> {t.analytics.dates} | 
                        <strong className="text-blue-600"> {t.analytics.yAxis}:</strong> {t.analytics.numberOfInjections}
                      </p>
                      <ScrollableChart height={300} minInnerWidth={insulinByDate.length * BAR_INNER_WIDTH_PER_ITEM}>
                        <BarChart data={insulinByDate}>
                          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                          <XAxis 
                            dataKey="date" 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.dates, position: 'insideBottom', offset: -5, style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <YAxis 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.numberOfInjections, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                          formatter={(value) => [
                              `${value} ${t.analytics.injections}`,
                              t.analytics.quantity
                            ]}
                            labelFormatter={(label) => `${t.analytics.date}: ${label}`}
                          />
                          <Bar dataKey="count" fill="#3B82F6" name={t.analytics.insulinInjections} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ScrollableChart>
                    </div>
                  </div>
                )}

                {/* Promedio de dosis de insulina por día */}
                {insulinDosesByDate.length > 0 && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg mr-3">
                          <Pill className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.averageInsulinDose}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsAverageInsulin} 
                        <strong className="text-blue-600"> {t.analytics.xAxis}:</strong> {t.analytics.dates} | 
                        <strong className="text-blue-600"> {t.analytics.yAxis}:</strong> {t.analytics.averageDoseUnits}
                      </p>
                      <ScrollableChart height={300} minInnerWidth={insulinDosesByDate.length * BAR_INNER_WIDTH_PER_ITEM}>
                        <BarChart data={insulinDosesByDate}>
                          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                          <XAxis 
                            dataKey="date" 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.dates, position: 'insideBottom', offset: -5, style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <YAxis 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.averageDoseUnits, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                          formatter={(value) => [
                              `${value} ${t.analytics.units}`,
                              t.analytics.averageDose
                            ]}
                            labelFormatter={(label) => `${t.analytics.date}: ${label}`}
                          />
                          <Bar dataKey="averageDose" fill="#6366F1" name={t.analytics.averageDose} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ScrollableChart>
                    </div>
                  </div>
                )}

                {/* Distribución de ánimo: barras ordinales 0..10 (anti-patrón
                    16: la distribución ordinal en un pie no expresa el orden
                    ni admite más de 5 sectores). Los niveles sin registros
                    cuentan 0 y siguen visibles en la escala. */}
                {moodLevelsHaveData && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg mr-3">
                          <Smile className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.moodDistribution}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsMoodFrequency} 
                        <strong className="text-pink-600"> {t.analytics.xAxis}:</strong> {t.analytics.level} | 
                        <strong className="text-pink-600"> {t.analytics.yAxis}:</strong> {t.analytics.numberOfRecords}
                      </p>
                      <ScrollableChart height={300} minInnerWidth={moodLevels.length * BAR_INNER_WIDTH_PER_ITEM}>
                        <BarChart data={moodLevels}>
                          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                          <XAxis
                            dataKey="level"
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                            tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.level, position: 'insideBottom', offset: -5, style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <YAxis
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                            tick={CHART_TICK_STYLE}
                            allowDecimals={false}
                            label={{ value: t.analytics.numberOfRecords, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <Tooltip
                            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                            formatter={(value) => [
                              `${value} ${t.analytics.records}`,
                              t.analytics.mood
                            ]}
                            labelFormatter={(label) => `${t.analytics.level}: ${label}/10`}
                          />
                          <Bar dataKey="count" fill="#EC4899" name={t.analytics.moodRecords} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ScrollableChart>
                    </div>
                  </div>
                )}
              </div>

              {/* MT39: separador entre las gráficas por tipo de dato y las
                  gráficas de evolución temporal. */}
              <div
                className="flex items-center gap-4 pt-2"
                role="separator"
                aria-orientation="horizontal"
              >
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-blue-300/70 to-transparent" />
                <h2 className="flex items-center gap-2 whitespace-nowrap text-base font-bold text-slate-800 sm:text-lg">
                  <span className="inline-flex rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 p-1.5">
                    <TrendingUp className="h-4 w-4 text-white" />
                  </span>
                  {t.analytics.timeEvolutionTitle}
                </h2>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-blue-300/70 to-transparent" />
              </div>

              {/* Gráficos de evolución temporal */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Correlación Insulina vs Carbohidratos */}
                {insulinData.length > 0 && foodData.length > 0 && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-blue-500 to-green-600 rounded-lg mr-3">
                          <TrendingUp className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.insulinEvolution}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsInsulinInjections} 
                        <strong className="text-blue-600"> {t.analytics.xAxis}:</strong> {t.analytics.dates} | 
                        <strong className="text-blue-600"> {t.analytics.yAxis}:</strong> {t.analytics.numberOfInjections}
                      </p>
                      <ScrollableChart height={300} minInnerWidth={insulinByDate.length * LINE_INNER_WIDTH_PER_ITEM}>
                        <LineChart data={insulinByDate}>
                          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                          <XAxis 
                            dataKey="date" 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.dates, position: 'insideBottom', offset: -5, style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <YAxis 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.numberOfInjections, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                          formatter={(value) => [
                              `${value} ${t.analytics.injections}`, 
                              t.analytics.insulin
                            ]}
                            labelFormatter={(label) => `${t.analytics.date}: ${label}`}
                          />
                          <Line type="monotone" dataKey="count" stroke="#3B82F6" strokeWidth={2} name={t.analytics.insulinInjections} />
                        </LineChart>
                      </ScrollableChart>
                    </div>
                  </div>
                )}

                {/* Patrones de Actividad Diaria */}
                {foodByDate.length > 0 && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg mr-3">
                          <Activity className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.mealEvolution}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsMealRegistrations} 
                        <strong className="text-green-400"> {t.analytics.xAxis}:</strong> {t.analytics.dates} | 
                        <strong className="text-green-400"> {t.analytics.yAxis}:</strong> {t.analytics.numberOfMeals}
                      </p>
                      <ScrollableChart height={300} minInnerWidth={foodByDate.length * LINE_INNER_WIDTH_PER_ITEM}>
                        <LineChart data={foodByDate}>
                          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                          <XAxis 
                            dataKey="date" 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.dates, position: 'insideBottom', offset: -5, style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <YAxis 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.numberOfMeals, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                          formatter={(value) => [
                              `${value} ${t.analytics.meals}`, 
                              t.analytics.records
                            ]}
                            labelFormatter={(label) => `${t.analytics.date}: ${label}`}
                          />
                          <Line type="monotone" dataKey="count" stroke="#10B981" strokeWidth={2} name={t.analytics.registeredMeals} />
                        </LineChart>
                      </ScrollableChart>
                    </div>
                  </div>
                )}

                {/* Tendencias de Ejercicio */}
                {exerciseByDate.length > 0 && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg mr-3">
                          <Dumbbell className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.exerciseEvolution}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsExerciseSessions} 
                        <strong className="text-orange-600"> {t.analytics.xAxis}:</strong> {t.analytics.dates} | 
                        <strong className="text-orange-600"> {t.analytics.yAxis}:</strong> {t.analytics.numberOfSessions}
                      </p>
                      <ScrollableChart height={300} minInnerWidth={exerciseByDate.length * LINE_INNER_WIDTH_PER_ITEM}>
                        <LineChart data={exerciseByDate}>
                          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                          <XAxis 
                            dataKey="date" 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.dates, position: 'insideBottom', offset: -5, style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <YAxis 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.numberOfSessions, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                          formatter={(value) => [
                              `${value} ${t.analytics.sessions}`, 
                              t.analytics.exercise
                            ]}
                            labelFormatter={(label) => `${t.analytics.date}: ${label}`}
                          />
                          <Line type="monotone" dataKey="count" stroke="#F59E0B" strokeWidth={2} name={t.analytics.exerciseSessions} />
                        </LineChart>
                      </ScrollableChart>
                    </div>
                  </div>
                )}

                {/* Bienestar Emocional */}
                {moodByDate.length > 0 && (
                  <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>
                    
                    <div className="relative z-10">
                      <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg mr-3">
                          <Heart className="h-5 w-5 text-white" />
                        </div>
                        {t.analytics.moodEvolution}
                      </h3>
                      <p className="text-sm text-slate-600 mb-6">
                        {t.analytics.showsMoodRecords} 
                        <strong className="text-pink-600"> {t.analytics.xAxis}:</strong> {t.analytics.dates} | 
                        <strong className="text-pink-600"> {t.analytics.yAxis}:</strong> {t.analytics.numberOfMoodRecords}
                      </p>
                      <ScrollableChart height={300} minInnerWidth={moodByDate.length * LINE_INNER_WIDTH_PER_ITEM}>
                        <LineChart data={moodByDate}>
                          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE} />
                          <XAxis 
                            dataKey="date" 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.dates, position: 'insideBottom', offset: -5, style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <YAxis 
                            stroke={CHART_AXIS_LINE_STYLE.stroke}
                          tick={CHART_TICK_STYLE}
                            label={{ value: t.analytics.numberOfRecords, angle: -90, position: 'insideLeft', style: { ...CHART_AXIS_LABEL_STYLE } }}
                          />
                          <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                          formatter={(value) => [
                              `${value} ${t.analytics.records}`, 
                              t.analytics.mood
                            ]}
                            labelFormatter={(label) => `${t.analytics.date}: ${label}`}
                          />
                          <Line type="monotone" dataKey="count" stroke="#EC4899" strokeWidth={2} name={t.analytics.moodRecords} />
                        </LineChart>
                      </ScrollableChart>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </ProtectedRoute>
  )
} 