'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase, User, InsulinData, FoodData, ExerciseData, PeriodRecord, MoodData } from '@/lib/supabase'
import { Users, Activity, TrendingUp, AlertTriangle, Heart, Calendar, User as UserIcon, Filter, Pill, Utensils, Dumbbell, CalendarDays, Smile, Clock, BarChart3, PieChart as PieChartIcon, LineChart as LineChartIcon, Database, Shield, Zap, Target } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area } from 'recharts'
import HybridProtectedRoute from '@/components/HybridProtectedRoute'
import HybridNavigation from '@/components/HybridNavigation'
import { useLanguage } from '@/contexts/LanguageContext'
import LanguageSelector from '@/components/LanguageSelector'

export default function OverviewPage() {
  const { t } = useLanguage()
  const [insulinData, setInsulinData] = useState<InsulinData[]>([])
  const [foodData, setFoodData] = useState<FoodData[]>([])
  const [exerciseData, setExerciseData] = useState<ExerciseData[]>([])
  const [periodData, setPeriodData] = useState<PeriodRecord[]>([])
  const [moodData, setMoodData] = useState<MoodData[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [systemStats, setSystemStats] = useState({
    totalUsers: 0,
    totalRecords: 0,
    totalInsulin: 0,
    totalFood: 0,
    totalExercise: 0,
    totalPeriods: 0,
    totalMood: 0,
    activeUsers: 0,
    avgInsulinDose: 0,
    avgCarbs: 0,
    avgMood: 0,
    lastActivity: null as Date | null
  })

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      
      // Llamar al endpoint que descifra los datos
      const response = await fetch('/api/decrypted-data')
      
      if (!response.ok) {
        throw new Error('Error al obtener datos descifrados')
      }

      const data = await response.json()
      
      // Los datos ya vienen descifrados del servidor
      setInsulinData(data.insulinData || [])
      setFoodData(data.foodData || [])
      setExerciseData(data.exerciseData || [])
      setPeriodData(data.periodData || [])
      setMoodData(data.moodData || [])
      
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUsers = useCallback(async () => {
    try {
      const { data: result, error } = await supabase
        .from('users')
        .select('*')
        .order('Username')

      if (error) throw error
      setUsers(result || [])
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }, [])

  useEffect(() => {
    fetchData()
    fetchUsers()
  }, [fetchData, fetchUsers])

  // Calcular estadísticas cuando los datos cambien
  useEffect(() => {
    console.log('useEffect ejecutándose con datos:', {
      insulinData: insulinData.length,
      foodData: foodData.length,
      exerciseData: exerciseData.length,
      periodData: periodData.length,
      moodData: moodData.length,
      users: users.length
    })
    
    // Siempre calcular estadísticas, incluso si no hay datos
      const stats = {
        totalUsers: users.length,
        totalRecords: insulinData.length + foodData.length + exerciseData.length + periodData.length + moodData.length,
        totalInsulin: insulinData.length,
        totalFood: foodData.length,
        totalExercise: exerciseData.length,
        totalPeriods: periodData.length,
        totalMood: moodData.length,
        
        // Usuarios activos (con actividad en los últimos 7 días)
        activeUsers: users.filter(user => {
          const userInsulin = insulinData.filter(d => d.username === user.Username)
          const userFood = foodData.filter(d => d.username === user.Username)
          const userExercise = exerciseData.filter(d => d.username === user.Username)
          const userPeriods = periodData.filter(d => d.username === user.Username)
          const userMood = moodData.filter(d => d.username === user.Username)
          
          const allUserData = [...userInsulin, ...userFood, ...userExercise, ...userPeriods, ...userMood]
          return isRecentlyActive(allUserData)
        }).length,
        
        // Promedios
        avgInsulinDose: insulinData.length > 0 
          ? Math.round(insulinData.reduce((sum, item) => sum + parseFloat(item.dose || '0'), 0) / insulinData.length * 10) / 10 
          : 0,
        avgCarbs: foodData.length > 0 
          ? Math.round(foodData.reduce((sum, item) => sum + parseFloat(item.carbs || '0'), 0) / foodData.length * 10) / 10 
          : 0,
        avgMood: moodData.length > 0 
          ? Math.round(moodData.reduce((sum, item) => sum + parseFloat(item.mood_value || '0'), 0) / moodData.length * 10) / 10 
          : 0,
        
        // Última actividad del sistema
        lastActivity: null as Date | null
      }

      // Encontrar la actividad más reciente
      const allDates = [
        ...insulinData.map(d => new Date(d.date_time)),
        ...foodData.map(d => new Date(d.date_time)),
        ...exerciseData.map(d => new Date(d.date_time)),
        ...periodData.map(d => new Date(d.startDate)),
        ...moodData.map(d => new Date(d.date_time))
      ]

      if (allDates.length > 0) {
        stats.lastActivity = new Date(Math.max(...allDates.map(d => d.getTime())))
      }

      setSystemStats(stats)
      console.log('Estadísticas actualizadas:', stats)
  }, [insulinData, foodData, exerciseData, periodData, moodData, users])

  // Función para calcular actividad reciente (últimos 7 días)
  const isRecentlyActive = (userData: any[]) => {
    if (userData.length === 0) return false
    const lastRecord = userData.sort((a, b) => 
      new Date(b.date_time || b.startDate).getTime() - new Date(a.date_time || a.startDate).getTime()
    )[0]
    const daysSinceLastRecord = (Date.now() - new Date(lastRecord.date_time || lastRecord.startDate).getTime()) / (1000 * 60 * 60 * 24)
    return daysSinceLastRecord <= 7
  }


  // Usuarios más activos
  const mostActiveUsers = users.map(user => {
    const userInsulin = insulinData.filter(d => d.username === user.Username)
    const userFood = foodData.filter(d => d.username === user.Username)
    const userExercise = exerciseData.filter(d => d.username === user.Username)
    const userPeriods = periodData.filter(d => d.username === user.Username)
    const userMood = moodData.filter(d => d.username === user.Username)
    
    const allUserData = [...userInsulin, ...userFood, ...userExercise, ...userPeriods, ...userMood]
    const recordCount = allUserData.length
    
    return {
      ...user,
      recordCount,
      insulinCount: userInsulin.length,
      foodCount: userFood.length,
      exerciseCount: userExercise.length,
      periodCount: userPeriods.length,
      moodCount: userMood.length,
      lastActivity: allUserData.length > 0 ? 
        new Date(Math.max(...allUserData.map(d => new Date(d.date_time || d.startDate).getTime()))) : 
        null,
      isActive: isRecentlyActive(allUserData)
    }
  }).sort((a, b) => b.recordCount - a.recordCount).slice(0, 5)

  // Datos recientes (últimos 10 registros de cualquier tipo)
  const recentData = [
    ...insulinData.map(item => ({ ...item, type: 'insulin', displayDate: item.date_time })),
    ...foodData.map(item => ({ ...item, type: 'food', displayDate: item.date_time })),
    ...exerciseData.map(item => ({ ...item, type: 'exercise', displayDate: item.date_time })),
    ...periodData.map(item => ({ ...item, type: 'period', displayDate: item.startDate })),
    ...moodData.map(item => ({ ...item, type: 'mood', displayDate: item.date_time }))
  ].sort((a, b) => new Date(b.displayDate).getTime() - new Date(a.displayDate).getTime()).slice(0, 10)

  // Alertas del sistema
  const systemAlerts = []
  
  // Alerta si menos del 50% de usuarios están activos
  if (systemStats.activeUsers < systemStats.totalUsers * 0.5 && systemStats.totalUsers > 0) {
    systemAlerts.push({
      type: 'warning',
      message: t.overview.onlyActiveUsers.replace('{active}', systemStats.activeUsers.toString()).replace('{total}', systemStats.totalUsers.toString()),
      icon: AlertTriangle
    })
  }

  // Alerta si no hay datos recientes
  if (systemStats.lastActivity && (Date.now() - systemStats.lastActivity.getTime()) > 7 * 24 * 60 * 60 * 1000) {
    systemAlerts.push({
      type: 'danger',
      message: t.overview.noRecentActivity,
      icon: AlertTriangle
    })
  }

  // Alerta si el promedio de estado de ánimo es bajo
  if (systemStats.avgMood < 5 && systemStats.totalMood > 0) {
    systemAlerts.push({
      type: 'info',
      message: `Promedio de estado de ánimo bajo: ${systemStats.avgMood}/10`,
      icon: AlertTriangle
    })
  }

  // Debug: Log de datos para verificar
  console.log('Debug Overview Data:', {
    insulinData: insulinData.length,
    foodData: foodData.length,
    exerciseData: exerciseData.length,
    periodData: periodData.length,
    moodData: moodData.length,
    totalRecords: systemStats.totalRecords
  })

  // Datos para gráficos
  const dataByType = [
    { name: t.overview.insulin, value: systemStats.totalInsulin, color: '#3B82F6' },
    { name: t.overview.meals, value: systemStats.totalFood, color: '#10B981' },
    { name: t.overview.exercise, value: systemStats.totalExercise, color: '#F59E0B' },
    { name: t.overview.periods, value: systemStats.totalPeriods, color: '#8B5CF6' },
    { name: t.overview.mood, value: systemStats.totalMood, color: '#EC4899' }
  ]

  // Actividad por día (últimos 7 días)
  const activityByDay = Array.from({ length: 7 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })
    
    const dayInsulin = insulinData.filter(d => 
      new Date(d.date_time).toDateString() === date.toDateString()
    ).length
    const dayFood = foodData.filter(d => 
      new Date(d.date_time).toDateString() === date.toDateString()
    ).length
    const dayExercise = exerciseData.filter(d => 
      new Date(d.date_time).toDateString() === date.toDateString()
    ).length
    const dayMood = moodData.filter(d => 
      new Date(d.date_time).toDateString() === date.toDateString()
    ).length
    
    return {
      date: dateStr,
      total: dayInsulin + dayFood + dayExercise + dayMood,
      insulina: dayInsulin,
      comidas: dayFood,
      ejercicio: dayExercise,
      estadoAnimo: dayMood
    }
  }).reverse()

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'insulin': return <Pill className="h-4 w-4 text-blue-600" />
      case 'food': return <Utensils className="h-4 w-4 text-green-600" />
      case 'exercise': return <Dumbbell className="h-4 w-4 text-orange-600" />
      case 'period': return <CalendarDays className="h-4 w-4 text-purple-600" />
      case 'mood': return <Smile className="h-4 w-4 text-pink-600" />
      default: return <Activity className="h-4 w-4 text-gray-600" />
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'insulin': return t.overview.insulin
      case 'food': return t.overview.meals
      case 'exercise': return t.overview.exercise
      case 'period': return t.overview.periods
      case 'mood': return t.overview.mood
      default: return t.overview.unknown
    }
  }

  return (
    <HybridProtectedRoute>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden" style={{ colorScheme: 'light' }}>
        {/* Elementos decorativos de fondo */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-72 h-72 bg-blue-200/20 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute top-40 right-10 w-96 h-96 bg-indigo-200/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
          <div className="absolute bottom-20 left-1/4 w-80 h-80 bg-purple-200/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '4s' }}></div>
        </div>

        {/* Language Selector */}
        <div className="absolute top-6 right-6 z-20">
          <LanguageSelector />
        </div>
        
        <HybridNavigation title={t.dashboard.generalSummary} showBackButton={true} />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
          {/* Header */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
              <div className="text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start mb-4">
                  <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg">
                    <Database className="h-8 w-8 text-white" />
                  </div>
                </div>
                <h1 className="text-4xl font-bold text-blue-600 mb-2">
                  {t.overview.title}
                </h1>
                <p className="text-gray-600 text-lg">{t.overview.subtitle}</p>
              </div>
              <div className="flex items-center space-x-3 mt-6 sm:mt-0">
                <div className="flex items-center text-sm text-green-600 bg-green-50 border border-green-200 rounded-xl px-4 py-2">
                  <Database className="h-4 w-4 mr-2 text-green-600" />
                  {t.overview.systemActive}
                </div>
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
              </div>
            </div>
          </div>

          {/* Estadísticas principales */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-blue-600">{t.overview.totalUsersOverview}</h3>
                  <p className="text-3xl font-bold text-blue-600">{systemStats.totalUsers}</p>
                  <p className="text-sm text-gray-600">
                    {systemStats.activeUsers} {t.overview.activeUsers} ({systemStats.totalUsers > 0 ? Math.round((systemStats.activeUsers / systemStats.totalUsers) * 100) : 0}%)
                  </p>
                </div>
              </div>
            </div>

            <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg">
                    <Database className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-blue-600">{t.overview.totalRecordsOverview}</h3>
                  <p className="text-3xl font-bold text-green-600">{systemStats.totalRecords}</p>
                  <p className="text-sm text-gray-600">
                    {systemStats.totalUsers > 0 ? Math.round(systemStats.totalRecords / systemStats.totalUsers) : 0} {t.overview.recordsPerUser}
                  </p>
                </div>
              </div>
            </div>

            <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="p-2 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg">
                    <Target className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-blue-600">{t.overview.averageInsulin}</h3>
                  <p className="text-3xl font-bold text-purple-600">{systemStats.avgInsulinDose}</p>
                  <p className="text-sm text-gray-600">{t.overview.unitsPerRecord}</p>
                </div>
              </div>
            </div>

            <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="p-2 bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg">
                    <Smile className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-blue-600">{t.overview.moodLevel}</h3>
                  <p className="text-3xl font-bold text-pink-600">{systemStats.avgMood}/10</p>
                  <p className="text-sm text-gray-600">{t.overview.generalAverage}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Estadísticas por tipo de dato */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            <div className="text-center p-6 bg-white border border-gray-200 rounded-xl shadow-lg">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg w-fit mx-auto mb-4">
                <Pill className="h-8 w-8 text-white" />
              </div>
              <p className="text-2xl font-bold text-blue-600">{systemStats.totalInsulin}</p>
              <p className="text-sm text-gray-600">{t.overview.insulin}</p>
            </div>
            <div className="text-center p-6 bg-white border border-gray-200 rounded-xl shadow-lg">
              <div className="p-3 bg-gradient-to-br from-green-500 to-green-600 rounded-lg w-fit mx-auto mb-4">
                <Utensils className="h-8 w-8 text-white" />
              </div>
              <p className="text-2xl font-bold text-green-600">{systemStats.totalFood}</p>
              <p className="text-sm text-gray-600">{t.overview.meals}</p>
            </div>
            <div className="text-center p-6 bg-white border border-gray-200 rounded-xl shadow-lg">
              <div className="p-3 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg w-fit mx-auto mb-4">
                <Dumbbell className="h-8 w-8 text-white" />
              </div>
              <p className="text-2xl font-bold text-orange-600">{systemStats.totalExercise}</p>
              <p className="text-sm text-gray-600">{t.overview.exercise}</p>
            </div>
            <div className="text-center p-6 bg-white border border-gray-200 rounded-xl shadow-lg">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg w-fit mx-auto mb-4">
                <CalendarDays className="h-8 w-8 text-white" />
              </div>
              <p className="text-2xl font-bold text-purple-600">{systemStats.totalPeriods}</p>
              <p className="text-sm text-gray-600">{t.overview.periods}</p>
            </div>
            <div className="text-center p-6 bg-white border border-gray-200 rounded-xl shadow-lg">
              <div className="p-3 bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg w-fit mx-auto mb-4">
                <Smile className="h-8 w-8 text-white" />
              </div>
              <p className="text-2xl font-bold text-pink-600">{systemStats.totalMood}</p>
              <p className="text-sm text-gray-600">{t.overview.mood}</p>
            </div>
          </div>

          {/* Alertas del sistema */}
          {systemAlerts.length > 0 && (
            <div className="relative bg-white border border-gray-200 rounded-2xl p-8 mb-8 shadow-lg">
              <div className="relative z-10">
                <h2 className="text-xl font-bold text-blue-600 mb-6 flex items-center">
                  <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg mr-3">
                    <AlertTriangle className="h-5 w-5 text-white" />
                  </div>
                  {t.overview.systemAlerts}
                </h2>
                <div className="space-y-4">
                  {systemAlerts.map((alert, index) => (
                    <div key={index} className={`flex items-center p-4 rounded-xl border ${
                      alert.type === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                      alert.type === 'danger' ? 'bg-red-50 border-red-200' :
                      'bg-blue-50 border-blue-200'
                    }`}>
                      <div className={`p-2 rounded-lg mr-4 ${
                        alert.type === 'warning' ? 'bg-gradient-to-br from-yellow-500 to-amber-600' :
                        alert.type === 'danger' ? 'bg-gradient-to-br from-red-500 to-rose-600' :
                        'bg-gradient-to-br from-blue-500 to-cyan-600'
                      }`}>
                        <alert.icon className="h-5 w-5 text-white" />
                      </div>
                      <span className={`text-sm font-medium ${
                        alert.type === 'warning' ? 'text-yellow-800' :
                        alert.type === 'danger' ? 'text-red-800' :
                        'text-blue-800'
                      }`}>
                        {alert.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Distribución por tipo de dato */}
            <div className="relative bg-white border border-gray-200 rounded-2xl p-8 shadow-lg">
              <div className="relative z-10">
                <h3 className="text-xl font-bold text-blue-600 mb-6 flex items-center">
                  <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg mr-3">
                    <PieChartIcon className="h-5 w-5 text-white" />
                  </div>
                  {t.overview.dataDistributionByType}
                </h3>
                {loading ? (
                  <div className="h-64 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={dataByType}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {dataByType.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'rgba(30, 41, 59, 0.95)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderRadius: '12px',
                          color: 'white'
                        }}
                        itemStyle={{ color: 'white' }}
                        labelStyle={{ color: 'white' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Actividad por día */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-medium text-black mb-4 flex items-center">
                <LineChartIcon className="h-5 w-5 text-green-600 mr-2" />
                {t.overview.activityLast7Days}
              </h3>
              {loading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={activityByDay}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'rgba(30, 41, 59, 0.95)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '12px',
                        color: 'white'
                      }}
                      itemStyle={{ color: 'white' }}
                      labelStyle={{ color: 'white' }}
                    />
                    <Area type="monotone" dataKey="total" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Usuarios más activos */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-medium text-black mb-4 flex items-center">
                <TrendingUp className="h-5 w-5 text-green-600 mr-2" />
                {t.overview.mostActiveUsers}
              </h2>
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <div className="space-y-4">
                  {mostActiveUsers.map((user, index) => (
                    <div key={user.UserID} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                          <span className="text-sm font-medium text-blue-600">{index + 1}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-black">{user.Username}</p>
                          <p className="text-xs text-gray-600">
                            {user.recordCount} registros totales
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center space-x-1">
                          {user.isActive && (
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          )}
                          <span className="text-sm text-black">{user.recordCount}</span>
                        </div>
                        {user.lastActivity && (
                          <p className="text-xs text-gray-600">
                            {new Date(user.lastActivity).toLocaleDateString('es-ES')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Datos recientes */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-medium text-black mb-4 flex items-center">
                <Clock className="h-5 w-5 text-orange-600 mr-2" />
                {t.overview.recentActivity}
              </h2>
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentData.map((item, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                      <div className="flex items-center">
                        {getTypeIcon(item.type)}
                        <div className="ml-3">
                          <p className="text-sm font-medium text-black">
                            {getTypeLabel(item.type)} - {item.username}
                          </p>
                          <p className="text-xs text-gray-600">
                            {new Date(item.displayDate).toLocaleDateString('es-ES')}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          item.type === 'insulin' ? 'bg-blue-100 text-blue-800' :
                          item.type === 'food' ? 'bg-green-100 text-green-800' :
                          item.type === 'exercise' ? 'bg-orange-100 text-orange-800' :
                          item.type === 'period' ? 'bg-purple-100 text-purple-800' :
                          'bg-pink-100 text-pink-800'
                        }`}>
                          {getTypeLabel(item.type)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Métricas adicionales */}
          <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-medium text-black mb-4 flex items-center">
              <BarChart3 className="h-5 w-5 text-indigo-600 mr-2" />
              {t.overview.additionalSystemMetrics}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{systemStats.avgCarbs}</p>
                <p className="text-sm text-gray-600">{t.overview.averageCarbs}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{systemStats.totalUsers > 0 ? Math.round(systemStats.totalRecords / systemStats.totalUsers) : 0}</p>
                <p className="text-sm text-gray-600">{t.overview.recordsPerUser}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-600">
                  {systemStats.lastActivity ? 
                    Math.ceil((Date.now() - systemStats.lastActivity.getTime()) / (1000 * 60 * 60 * 24)) : 
                    0
                  }
                </p>
                <p className="text-sm text-gray-600">{t.overview.daysSinceLastActivity}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-orange-600">
                  {systemStats.totalUsers > 0 ? Math.round((systemStats.activeUsers / systemStats.totalUsers) * 100) : 0}%
                </p>
                <p className="text-sm text-gray-600">{t.overview.activeUsersRate}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </HybridProtectedRoute>
  )
} 