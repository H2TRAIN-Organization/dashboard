'use client'

import Link from 'next/link'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { User, InsulinData, FoodData, ExerciseData, PeriodRecord, MoodData } from '@/lib/api-types'
import { dataApi, errorMessage, usersApi } from '@/lib/api-client'
import { getDisplayUsername } from '@/lib/user-mapper'
import { Download, Activity, Calendar, Filter, Clock, Pill, Utensils, Dumbbell, CalendarDays, Smile, ChevronDown, ChevronUp, Eye, EyeOff, Database, Trash2, type LucideIcon } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import Navigation from '@/components/Navigation'
import CalendarDatePicker from '@/components/calendar/CalendarDatePicker'
import { formatDateValue } from '@/components/calendar/calendar-utils'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import UserAutocomplete from './user-autocomplete'
import {
  HEALTH_DATA_CATEGORIES,
  buildHealthCsvDocument,
  healthCsvFilename,
  type HealthDataCategory,
} from '@/lib/health-csv'
import { isUserGroupExpanded, usersForRecordGroups, visibleMetricCards } from '@/lib/dashboard-data'

// Errors raised locally use a translation key so the visible text follows the
// language selector; backend errors are shown unchanged.
type DataLoadError =
  | { kind: 'translated'; key: 'missingUsername' | 'queryTimeout' }
  | { kind: 'message'; message: string }

export default function DataPage() {
  const { session } = useSession()
  const { t, language } = useLanguage()
  const locale = language === 'en' ? 'en-US' : 'es-ES'
  
  const [insulinData, setInsulinData] = useState<InsulinData[]>([])
  const [foodData, setFoodData] = useState<FoodData[]>([])
  const [exerciseData, setExerciseData] = useState<ExerciseData[]>([])
  const [periodData, setPeriodData] = useState<PeriodRecord[]>([])
  const [moodData, setMoodData] = useState<MoodData[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [error, setError] = useState<DataLoadError | null>(null)
  const [selectedUser, setSelectedUser] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [timeRange, setTimeRange] = useState<string>('all')
  const [selectedDataType, setSelectedDataType] = useState<string>('all')
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())
  const [showAllRecords, setShowAllRecords] = useState<Set<string>>(new Set())
  const [usersError, setUsersError] = useState<string | null>(null)
  const [usersLoading, setUsersLoading] = useState(true)
  
  // Regular users only ever receive their own data; admins and doctors may read all.
  const currentRole = session?.user.role ?? null
  const currentUsername = session?.user.username ?? null
  const isIndividualUser = currentRole === 'user'

  // Sequence guards and cancellation keep late responses from a previous
  // filter or account from overwriting the current view.
  const dataRequestRef = useRef(0)
  const dataAbortRef = useRef<AbortController | null>(null)
  const usersRequestRef = useRef(0)

  const errorText = error
    ? error.kind === 'translated'
      ? t.data[error.key]
      : error.message
    : null
  
  // Date shown by the shared calendar as "today". Freezing it at mount keeps
  // the highlight stable for the lifetime of the page.
  const [today] = useState(() => new Date())

  const cancelDataRequest = useCallback(() => {
    dataRequestRef.current += 1
    dataAbortRef.current?.abort()
    dataAbortRef.current = null
  }, [])

  const fetchData = useCallback(async () => {
    const requestId = dataRequestRef.current + 1
    dataRequestRef.current = requestId
    // Abort the previous request before starting a new one. Its catch/finally
    // sees a stale requestId and cannot overwrite state.
    dataAbortRef.current?.abort()
    const controller = new AbortController()
    dataAbortRef.current = controller
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 30000)

    try {
      setLoading(true)
      setLoadingProgress(0)
      setError(null)
      // A new filter/account must not retain the previous owner's records if
      // its request later fails or times out.
      setInsulinData([])
      setFoodData([])
      setExerciseData([])
      setPeriodData([])
      setMoodData([])

      setLoadingProgress(20)

      const selected = isIndividualUser ? (currentUsername ?? '') : selectedUser
      if (isIndividualUser && selected.length === 0) {
        if (requestId === dataRequestRef.current) {
          setError({ kind: 'translated', key: 'missingUsername' })
        }
        return
      }

      setLoadingProgress(40)
      const data = await dataApi.getDecrypted(
        {
          selectedUser: selected,
          timeRange: timeRange as '7d' | '30d' | '90d' | 'all',
          selectedDataType: selectedDataType as 'all' | 'insulin' | 'food' | 'exercise' | 'period' | 'mood',
          dateFilter: dateFilter || undefined,
        },
        { signal: controller.signal },
      )

      if (requestId !== dataRequestRef.current) return
      if (controller.signal.aborted) {
        // A timeout can settle after the response arrives; an abort caused by
        // a newer filter or by unmount has already failed the guard above.
        if (timedOut) setError({ kind: 'translated', key: 'queryTimeout' })
        return
      }

      setLoadingProgress(80)
      setInsulinData(data.insulinData)
      setFoodData(data.foodData)
      setExerciseData(data.exerciseData)
      setPeriodData(data.periodData)
      setMoodData(data.moodData)
      setLoadingProgress(100)
    } catch (caught) {
      if (requestId !== dataRequestRef.current) return
      if (timedOut) {
        setError({ kind: 'translated', key: 'queryTimeout' })
        return
      }
      // A filter/account change aborts the request on purpose; showing an
      // error for the superseded request would be a false failure.
      if (caught instanceof Error && caught.name === 'AbortError') return
      console.error('Error fetching data:', caught)
      setError({ kind: 'message', message: errorMessage(caught) })
    } finally {
      window.clearTimeout(timeoutId)
      if (requestId === dataRequestRef.current) {
        dataAbortRef.current = null
        setLoading(false)
      }
    }
  }, [selectedUser, dateFilter, timeRange, selectedDataType, isIndividualUser, currentUsername])

  const fetchUsers = useCallback(async () => {
    const requestId = usersRequestRef.current + 1
    usersRequestRef.current = requestId
    try {
      setUsersLoading(true)
      setUsersError(null)
      const result = await usersApi.listAll()
      if (requestId !== usersRequestRef.current) return
      setUsers(result.users)
    } catch (caught) {
      if (requestId !== usersRequestRef.current) return
      console.error('Error fetching users:', caught)
      // The data itself can still be shown; only the administrative user
      // picker reports this failure.
      setUsersError(errorMessage(caught))
    } finally {
      if (requestId === usersRequestRef.current) {
        setUsersLoading(false)
      }
    }
  }, [])

  // The user catalogue is only reloaded with the session, never on a filter
  // change (DR07/DR11).
  useEffect(() => {
    if (!session) return
    let active = true
    const load = async () => {
      // Yield once so the effect body does not synchronously set state.
      await Promise.resolve()
      if (!active) return
      await fetchUsers()
    }
    void load()
    return () => {
      active = false
      usersRequestRef.current += 1
    }
  }, [session, fetchUsers])

  useEffect(() => {
    if (!session) return
    let active = true
    const load = async () => {
      // Yield once so the effect body does not synchronously set state.
      await Promise.resolve()
      if (!active) return
      await fetchData()
    }
    void load()
    return () => {
      active = false
      cancelDataRequest()
    }
  }, [session, fetchData, cancelDataRequest])

  const toggleUserExpansion = (userId: string) => {
    const newExpanded = new Set(expandedUsers)
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId)
    } else {
      newExpanded.add(userId)
    }
    setExpandedUsers(newExpanded)
  }

  const toggleShowAllRecords = (userId: string) => {
    const newShowAll = new Set(showAllRecords)
    if (newShowAll.has(userId)) {
      newShowAll.delete(userId)
    } else {
      newShowAll.add(userId)
    }
    setShowAllRecords(newShowAll)
  }

  const clearFilters = () => {
    setSelectedUser('all')
    setDateFilter('')
    setTimeRange('all')
    setSelectedDataType('all')
  }

  const handleCalendarMonthChange = (month: Date) => {
    // Preserve the previous Health Data behaviour: moving to another month
    // updates the date filter immediately, not only when a day is selected.
    setDateFilter(formatDateValue(month))
  }

  const selectDate = (value: string) => {
    setDateFilter(value)
  }

  const exportData = () => {
    const categories: readonly HealthDataCategory[] =
      selectedDataType === 'all'
        ? HEALTH_DATA_CATEGORIES
        : HEALTH_DATA_CATEGORIES.filter(
            (category) => category === selectedDataType,
          )

    // The API already applied the user, range and date filters. Every
    // authorized record is exported, including records hidden behind
    // "show less" in the cards (DR15).
    const csvContent = buildHealthCsvDocument(
      { insulinData, foodData, exerciseData, periodData, moodData },
      { categories },
    )

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = healthCsvFilename(categories)
    a.click()
    window.URL.revokeObjectURL(url)
  }

  // Estad├¡sticas de los datos
  const stats = {
    totalInsulin: insulinData.length,
    totalFood: foodData.length,
    totalExercise: exerciseData.length,
    totalPeriods: periodData.length,
    totalMood: moodData.length,
    totalRecords: insulinData.length + foodData.length + exerciseData.length + periodData.length + moodData.length
  }

  // DR12: once loading finished, a category without records is not rendered as
  // an empty metric card. This is a record count, so the values shown are real
  // positives; record-level values such as mood 0 or `out_of_routine: false`
  // are preserved in the cards and CSV below.
  const metricCards: Array<{
    key: string
    count: number
    label: string
    Icon: LucideIcon
    iconClass: string
    valueClass: string
    hoverClass: string
  }> = visibleMetricCards([
    {
      key: 'insulin',
      count: stats.totalInsulin,
      label: t.dashboard.insulin,
      Icon: Pill,
      iconClass: 'from-blue-600 to-blue-700',
      valueClass: 'text-blue-600',
      hoverClass: 'hover:shadow-blue-500/10',
    },
    {
      key: 'food',
      count: stats.totalFood,
      label: t.dashboard.food,
      Icon: Utensils,
      iconClass: 'from-green-600 to-green-700',
      valueClass: 'text-green-600',
      hoverClass: 'hover:shadow-green-500/10',
    },
    {
      key: 'exercise',
      count: stats.totalExercise,
      label: t.dashboard.exercise,
      Icon: Dumbbell,
      iconClass: 'from-orange-600 to-orange-700',
      valueClass: 'text-orange-600',
      hoverClass: 'hover:shadow-orange-500/10',
    },
    {
      key: 'period',
      count: stats.totalPeriods,
      label: t.dashboard.periods,
      Icon: CalendarDays,
      iconClass: 'from-purple-600 to-purple-700',
      valueClass: 'text-purple-600',
      hoverClass: 'hover:shadow-purple-500/10',
    },
    {
      key: 'mood',
      count: stats.totalMood,
      label: t.dashboard.mood,
      Icon: Smile,
      iconClass: 'from-pink-600 to-pink-700',
      valueClass: 'text-pink-600',
      hoverClass: 'hover:shadow-pink-500/10',
    },
    {
      key: 'total',
      count: stats.totalRecords,
      label: t.dashboard.total,
      Icon: Activity,
      iconClass: 'from-indigo-600 to-indigo-700',
      valueClass: 'text-indigo-600',
      hoverClass: 'hover:shadow-indigo-500/10',
    },
  ])

  // Group data by user. Usernames found only in the records are still grouped
  // so an incomplete user listing cannot hide authorized records (DR07/DR08).
  const groupableUsers = usersForRecordGroups(users, [
    ...insulinData.map(item => item.username),
    ...foodData.map(item => item.username),
    ...exerciseData.map(item => item.username),
    ...periodData.map(item => item.username),
    ...moodData.map(item => item.username),
  ])

  const userDataGroups = groupableUsers.map(user => {
    const userInsulin = insulinData.filter(item => item.username === user.Username)
    const userFood = foodData.filter(item => item.username === user.Username)
    const userExercise = exerciseData.filter(item => item.username === user.Username)
    const userPeriods = periodData.filter(item => item.username === user.Username)
    const userMood = moodData.filter(item => item.username === user.Username)
    
    const userStats = {
      totalRecords: userInsulin.length + userFood.length + userExercise.length + userPeriods.length + userMood.length,
      insulinCount: userInsulin.length,
      foodCount: userFood.length,
      exerciseCount: userExercise.length,
      periodCount: userPeriods.length,
      moodCount: userMood.length,
      lastActivity: null as Date | null
    }

    // Encontrar la actividad m├ís reciente
    const allDates = [
      ...userInsulin.map(d => new Date(d.date_time)),
      ...userFood.map(d => new Date(d.date_time)),
      ...userExercise.map(d => new Date(d.date_time)),
      ...userPeriods.map(d => new Date(d.startDate)),
      ...userMood.map(d => new Date(d.date_time))
    ]

    if (allDates.length > 0) {
      userStats.lastActivity = new Date(Math.max(...allDates.map(d => d.getTime())))
    }

    return { 
      user, 
      insulin: userInsulin, 
      food: userFood, 
      exercise: userExercise, 
      periods: userPeriods, 
      mood: userMood, 
      stats: userStats 
    }
  }).filter(group => group.stats.totalRecords > 0)

  const getDataTypeIcon = (type: string) => {
    switch (type) {
      case 'insulin': return <Pill className="h-4 w-4" />
      case 'food': return <Utensils className="h-4 w-4" />
      case 'exercise': return <Dumbbell className="h-4 w-4" />
      case 'period': return <CalendarDays className="h-4 w-4" />
      case 'mood': return <Smile className="h-4 w-4" />
      default: return <Activity className="h-4 w-4" />
    }
  }

  const renderDataRecords = (
    data: Array<InsulinData | FoodData | ExerciseData | PeriodRecord | MoodData>,
    type: string,
    maxRecords: number = 2,
  ) => {
    const recordsToShow = showAllRecords.has(type) ? data : data.slice(0, maxRecords)
    
    const getTypeColors = (type: string) => {
      switch (type) {
        case 'insulin': return { bg: 'from-blue-50 to-blue-100', border: 'border-blue-200', text: 'text-blue-600', icon: 'from-blue-500 to-blue-600' }
        case 'food': return { bg: 'from-green-50 to-green-100', border: 'border-green-200', text: 'text-green-600', icon: 'from-green-500 to-green-600' }
        case 'exercise': return { bg: 'from-orange-50 to-orange-100', border: 'border-orange-200', text: 'text-orange-600', icon: 'from-orange-500 to-orange-600' }
        case 'period': return { bg: 'from-purple-50 to-purple-100', border: 'border-purple-200', text: 'text-purple-600', icon: 'from-purple-500 to-purple-600' }
        case 'mood': return { bg: 'from-pink-50 to-pink-100', border: 'border-pink-200', text: 'text-pink-600', icon: 'from-pink-500 to-pink-600' }
        default: return { bg: 'from-gray-50 to-gray-100', border: 'border-gray-200', text: 'text-gray-600', icon: 'from-gray-500 to-gray-600' }
      }
    }
    
    const colors = getTypeColors(type)
    
    return (
      <div className="space-y-4">
        {recordsToShow.map((item) => (
          <div key={item.id} className={`bg-gradient-to-br ${colors.bg} backdrop-blur-sm border ${colors.border} rounded-xl p-4`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`inline-flex items-center px-3 py-1 text-sm font-semibold rounded-full ${colors.text} bg-gradient-to-r ${colors.icon} text-white`}>
                {getDataTypeIcon(type)}
                <span className="ml-2">
                  {type === 'insulin' ? t.dashboard.insulin :
                   type === 'food' ? t.dashboard.meals :
                   type === 'exercise' ? t.dashboard.exercise :
                   type === 'period' ? t.dashboard.periods : t.dashboard.mood}
                </span>
              </span>
              <span className="text-sm text-gray-600">
                {new Date(item.date_time || ('startDate' in item ? item.startDate : '')).toLocaleDateString(locale)}
              </span>
            </div>
            <div className="text-sm text-gray-800">
              {type === 'insulin' && 'insulinType' in item && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.type}:</strong> <span className="text-gray-700">{item.insulinType}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.dose}:</strong> <span className="text-gray-700">{item.dose}</span></p>
                </>
              )}
              {type === 'food' && 'food_type' in item && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.type}:</strong> <span className="text-gray-700">{item.food_type}</span></p>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.quantity}:</strong> <span className="text-gray-700">{item.quantity}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.carbs}:</strong> <span className="text-gray-700">{item.carbs}</span></p>
                </>
              )}
              {type === 'exercise' && 'exercise_type' in item && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.type}:</strong> <span className="text-gray-700">{item.exercise_type}</span></p>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.intensity}:</strong> <span className="text-gray-700">{item.intensity}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.description}:</strong> <span className="text-gray-700">{item.exercise_description}</span></p>
                </>
              )}
              {type === 'period' && 'symptoms' in item && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.intensity}:</strong> <span className="text-gray-700">{item.intensity}</span></p>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.symptoms}:</strong> <span className="text-gray-700">{Array.isArray(item.symptoms) ? item.symptoms.join(', ') : item.symptoms}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.notes}:</strong> <span className="text-gray-700">{item.notes}</span></p>
                </>
              )}
              {type === 'mood' && 'emotions' in item && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.value}:</strong> <span className="text-gray-700">{item.mood_value}/10</span></p>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.outOfRoutine}:</strong> <span className="text-gray-700">{item.out_of_routine ? t.dashboard.yes : t.dashboard.no}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.emotions}:</strong> <span className="text-gray-700">{Array.isArray(item.emotions) ? item.emotions.join(', ') : item.emotions}</span></p>
                </>
              )}
            </div>
          </div>
        ))}
        
        {data.length > maxRecords && (
          <button
            onClick={() => toggleShowAllRecords(type)}
            className="w-full text-center text-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 border border-blue-200 rounded-xl hover:from-blue-400 hover:to-blue-500 transition-all duration-300 transform hover:scale-105 flex items-center justify-center"
          >
            {showAllRecords.has(type) ? (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                {t.dashboard.showLess}
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 mr-2" />
                {t.dashboard.viewAll} {data.length} {t.dashboard.records2}
              </>
            )}
          </button>
        )}
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
        
        <Navigation title={t.dashboard.healthData} showBackButton={true} />

        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 lg:py-8 xl:py-12 relative z-10">
          {/* Header con estad├¡sticas */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-10 mb-6 sm:mb-12 overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 sm:mb-8 space-y-4 lg:space-y-0">
              <div className="flex flex-col sm:flex-row sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
                <div className="flex items-center space-x-4 sm:space-x-6">
                  <div className="p-3 sm:p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl sm:rounded-2xl shadow-lg">
                    <Database className="h-8 w-8 sm:h-12 sm:w-12 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-gray-900">
                      {t.dashboard.healthData}
                    </h2>
                    <p className="text-gray-600 text-sm sm:text-base lg:text-xl font-light max-w-xl lg:pr-6">{t.dashboard.healthDataDescription}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="flex items-center space-x-3 bg-white/80 backdrop-blur-sm border border-gray-200/50 px-4 sm:px-6 py-2 sm:py-3 rounded-xl shadow-lg">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm sm:text-base text-gray-800 font-semibold">
                    {stats.totalRecords} {t.dashboard.totalRecords}
                  </span>
                </div>
                <button
                  onClick={exportData}
                  className="flex items-center space-x-2 sm:space-x-3 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 shadow-lg hover:shadow-xl"
                >
                  <Download className="h-4 w-4 sm:h-5 sm:w-5" />
                  <span className="font-semibold text-sm sm:text-lg">{t.dashboard.exportCSV}</span>
                </button>
              </div>
            </div>
          </div>

          {errorText && (
            <div className="mb-6 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 sm:flex-row sm:items-center sm:justify-between">
              <span role="alert">{errorText}</span>
              <button
                type="button"
                onClick={() => void fetchData()}
                className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
              >
                {t.common.retry}
              </button>
            </div>
          )}

          {/* Estad├¡sticas generales: solo roles privilegiados y solo categor├¡as
              con datos tras terminar la carga (DR09/DR12). */}
          {!isIndividualUser && !loading && !error && metricCards.length > 0 && (
            <div className="mb-8 sm:mb-12">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
                {metricCards.map(({ key, count, label, Icon, iconClass, valueClass, hoverClass }) => (
                  <div key={key} className={`relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 hover:shadow-2xl ${hoverClass} transition-all duration-300 transform hover:-translate-y-1`}>
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className={`p-2 sm:p-3 lg:p-4 bg-gradient-to-br ${iconClass} rounded-xl sm:rounded-2xl shadow-lg`}>
                          <Icon className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                        </div>
                      </div>
                      <div className="ml-3 sm:ml-4 lg:ml-6">
                        <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-gray-900">{label}</h3>
                        <p className={`text-2xl sm:text-3xl lg:text-4xl font-bold ${valueClass}`}>{count}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filtros mejorados */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-10 mb-8 sm:mb-12 overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            
            <div className="relative z-10">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 space-y-3 sm:space-y-0">
                <div className="flex items-center">
                  <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg mr-3">
                    <Filter className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-blue-900">{t.dashboard.dataFilters}</h2>
                </div>
                <button
                  onClick={clearFilters}
                  className="px-3 sm:px-4 py-2 text-xs sm:text-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-400 hover:to-blue-500 transition-all duration-300 transform hover:scale-105 flex items-center"
                >
                  <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
                  {t.dashboard.clearFilters}
                </button>
              </div>
              
              <div className={`grid grid-cols-1 gap-4 sm:gap-6 ${isIndividualUser ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
                {!isIndividualUser && (
                  <UserAutocomplete
                    users={users}
                    value={selectedUser}
                    onChange={setSelectedUser}
                    label={t.dashboard.user}
                    allUsersLabel={t.dashboard.allUsers}
                    loading={usersLoading}
                    error={usersError}
                  />
                )}
                
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-blue-900 mb-2 sm:mb-3 flex items-center">
                    <Activity className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    {t.dashboard.dataType}
                  </label>
                  <select
                    value={selectedDataType}
                    onChange={(e) => setSelectedDataType(e.target.value)}
                    className="w-full bg-white border-2 border-blue-200 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-blue-900 shadow-lg hover:border-blue-300 transition-all duration-300 cursor-pointer appearance-none bg-gradient-to-r from-blue-50 to-indigo-50 text-sm sm:text-base"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 8px center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '12px'
                    }}
                  >
                    <option value="all" className="bg-white text-blue-900 py-2">{t.dashboard.allTypes}</option>
                    <option value="insulin" className="bg-white text-blue-900">{t.dashboard.insulin}</option>
                    <option value="food" className="bg-white text-blue-900">{t.dashboard.meals}</option>
                    <option value="exercise" className="bg-white text-blue-900">{t.dashboard.exercise}</option>
                    <option value="period" className="bg-white text-blue-900">{t.dashboard.periods}</option>
                    <option value="mood" className="bg-white text-blue-900">{t.dashboard.mood}</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-blue-900 mb-2 sm:mb-3 flex items-center">
                    <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    {t.dashboard.timeRange}
                  </label>
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                    className="w-full bg-white border-2 border-blue-200 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-blue-900 shadow-lg hover:border-blue-300 transition-all duration-300 cursor-pointer appearance-none bg-gradient-to-r from-blue-50 to-indigo-50 text-sm sm:text-base"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 8px center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '12px'
                    }}
                  >
                    <option value="all" className="bg-white text-blue-900 py-2">{t.dashboard.allTime}</option>
                    <option value="7d" className="bg-white text-blue-900">{t.data.last7Days}</option>
                    <option value="30d" className="bg-white text-blue-900">{t.data.last30Days}</option>
                    <option value="90d" className="bg-white text-blue-900">{t.data.last90Days}</option>
                  </select>
                </div>
                
                <div>
                  <label
                    htmlFor="health-data-date-trigger"
                    className="block text-xs sm:text-sm font-bold text-blue-900 mb-2 sm:mb-3 flex items-center"
                  >
                    <Calendar className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    {t.dashboard.specificDate}
                  </label>
                  <CalendarDatePicker
                    id="health-data-date-trigger"
                    value={dateFilter}
                    onChange={selectDate}
                    onMonthChange={handleCalendarMonthChange}
                    placeholder={t.dashboard.selectDate}
                    today={today}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Contenido principal */}
          {loading ? (
            <div className="relative bg-white backdrop-blur-xl border border-blue-200/50 rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-12 text-center shadow-lg">
              <div className="flex flex-col items-center justify-center space-y-4 sm:space-y-6">
                <div className="animate-spin rounded-full h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 border-b-2 border-blue-500"></div>
                <div className="w-full max-w-sm sm:max-w-md">
                  <div className="flex justify-between text-xs sm:text-sm text-blue-600 mb-2">
                    <span>{t.dashboard.loadingData}</span>
                    <span>{loadingProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${loadingProgress}%` }}
                    ></div>
                  </div>
                </div>
                <p className="text-blue-700 text-xs sm:text-sm">
                  {loadingProgress < 40 ? t.dashboard.connectingServer :
                   loadingProgress < 60 ? t.dashboard.decryptingData :
                   loadingProgress < 80 ? t.dashboard.processingInfo :
                   t.dashboard.finalizing}
                </p>
              </div>
            </div>
          ) : (
            /* Vista de tarjetas por usuario */
            <div className="space-y-4 sm:space-y-6 lg:space-y-8">
              {userDataGroups.length > 0 ? (
                userDataGroups.map((group) => {
                  const isExpanded = isUserGroupExpanded(
                    isIndividualUser,
                    group.user.UserID,
                    expandedUsers,
                  )
                  return (
                  <div key={group.user.UserID} className="relative bg-white backdrop-blur-xl border border-blue-200/50 rounded-2xl sm:rounded-3xl overflow-hidden shadow-lg">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-blue-100/50"></div>
                    
                    <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 border-b border-blue-200">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-3 sm:space-y-0">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg sm:text-xl font-bold text-blue-900 mb-1 break-words" title={getDisplayUsername(group.user)}>
                            {getDisplayUsername(group.user)}
                          </h3>
                          <p className="text-sm sm:text-base text-blue-700">
                            {group.stats.totalRecords} {t.dashboard.totalRecords}
                          </p>
                        </div>
                        <div className="flex items-center space-x-3 sm:space-x-6 w-full sm:w-auto justify-between sm:justify-end">
                          <div className="text-left sm:text-right">
                            <p className="text-xs sm:text-sm text-blue-600">{t.dashboard.lastActivity}</p>
                            <p className="text-xs sm:text-sm font-medium text-blue-900">
                              {group.stats.lastActivity ? 
                                new Date(group.stats.lastActivity).toLocaleDateString(locale) :
                                t.common.notAvailable
                              }
                            </p>
                          </div>
                          {!isIndividualUser && (
                            <button
                              type="button"
                              onClick={() => toggleUserExpansion(group.user.UserID)}
                              aria-expanded={isExpanded}
                              title={isExpanded ? t.dashboard.showLess : t.dashboard.viewAll}
                              className="p-2 sm:p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg sm:rounded-xl hover:from-blue-400 hover:to-blue-500 transition-all duration-300 transform hover:scale-105 flex-shrink-0"
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                              ) : (
                                <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="relative z-10 p-4 sm:p-6 lg:p-8">
                        {/* Resumen por tipo de dato: el usuario normal ve sus
                            categor├¡as directamente y sin resumen redundante
                            (DR09); las tarjetas vac├¡as no se muestran (DR12). */}
                        {!isIndividualUser && group.stats.totalRecords > 0 && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 lg:gap-6 mb-6 sm:mb-8">
                            {group.stats.insulinCount > 0 && (
                              <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-blue-50 to-blue-100 backdrop-blur-sm border border-blue-200 rounded-lg sm:rounded-xl">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                                  <Pill className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                                </div>
                                <p className="text-sm sm:text-base lg:text-lg font-bold text-blue-600">{group.stats.insulinCount}</p>
                                <p className="text-xs sm:text-sm text-blue-700">{t.dashboard.insulin}</p>
                              </div>
                            )}
                            {group.stats.foodCount > 0 && (
                              <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-green-50 to-green-100 backdrop-blur-sm border border-green-200 rounded-lg sm:rounded-xl">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                                  <Utensils className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                                </div>
                                <p className="text-sm sm:text-base lg:text-lg font-bold text-green-600">{group.stats.foodCount}</p>
                                <p className="text-xs sm:text-sm text-green-700">{t.dashboard.meals}</p>
                              </div>
                            )}
                            {group.stats.exerciseCount > 0 && (
                              <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-orange-50 to-orange-100 backdrop-blur-sm border border-orange-200 rounded-lg sm:rounded-xl">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                                  <Dumbbell className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                                </div>
                                <p className="text-sm sm:text-base lg:text-lg font-bold text-orange-600">{group.stats.exerciseCount}</p>
                                <p className="text-xs sm:text-sm text-orange-700">{t.dashboard.exercise}</p>
                              </div>
                            )}
                            {group.stats.periodCount > 0 && (
                              <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-purple-50 to-purple-100 backdrop-blur-sm border border-purple-200 rounded-lg sm:rounded-xl">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                                  <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                                </div>
                                <p className="text-sm sm:text-base lg:text-lg font-bold text-purple-600">{group.stats.periodCount}</p>
                                <p className="text-xs sm:text-sm text-purple-700">{t.dashboard.periods}</p>
                              </div>
                            )}
                            {group.stats.moodCount > 0 && (
                              <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-pink-50 to-pink-100 backdrop-blur-sm border border-pink-200 rounded-lg sm:rounded-xl">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                                  <Smile className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                                </div>
                                <p className="text-sm sm:text-base lg:text-lg font-bold text-pink-600">{group.stats.moodCount}</p>
                                <p className="text-xs sm:text-sm text-pink-700">{t.dashboard.mood}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Datos detallados por tipo */}
                        <div className="space-y-6 sm:space-y-8">
                          {/* Insulina */}
                          {group.insulin.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-blue-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg mr-2 sm:mr-3">
                                  <Pill className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.insulinData} ({group.insulin.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.insulin, 'insulin')}
                            </div>
                          )}

                          {/* Comidas */}
                          {group.food.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-green-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg mr-2 sm:mr-3">
                                  <Utensils className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.food} ({group.food.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.food, 'food')}
                            </div>
                          )}

                          {/* Ejercicio */}
                          {group.exercise.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-orange-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg mr-2 sm:mr-3">
                                  <Dumbbell className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.exercise} ({group.exercise.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.exercise, 'exercise')}
                            </div>
                          )}

                          {/* Per├¡odos */}
                          {group.periods.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-purple-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg mr-2 sm:mr-3">
                                  <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.periods} ({group.periods.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.periods, 'period')}
                            </div>
                          )}

                          {/* Estado de ├ínimo */}
                          {group.mood.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-pink-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg mr-2 sm:mr-3">
                                  <Smile className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.mood} ({group.mood.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.mood, 'mood')}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  )
                })
              ) : !error ? (
                <div className="relative bg-gradient-to-r from-slate-800/50 to-slate-900/50 backdrop-blur-xl border border-white/20 rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-12 text-center">
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-800/20 to-slate-900/20"></div>
                  <div className="relative z-10">
                    <div className="p-3 sm:p-4 bg-gradient-to-br from-green-500/20 to-emerald-600/20 backdrop-blur-sm border border-green-400/30 rounded-xl sm:rounded-2xl w-fit mx-auto mb-4 sm:mb-6">
                      <Activity className="h-12 w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16 text-green-400" />
                    </div>
                    <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-2 sm:mb-3">{t.dashboard.noDataFound}</h3>
                    <p className="text-white/70 text-sm sm:text-base lg:text-lg">{t.dashboard.noRecordsForFilters}</p>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
