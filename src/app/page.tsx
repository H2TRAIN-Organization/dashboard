'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Users, Activity, BarChart3, Home, Heart, Sparkles, Zap, Shield, TrendingUp, Brain, Settings } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleGuard from '@/components/RoleGuard'
import Navigation from '@/components/Navigation'
import { dataApi, errorMessage, usersApi } from '@/lib/api-client'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import LanguageSelector from '@/components/LanguageSelector'

export default function DashboardPage() {
  const { t } = useLanguage()
  const { session } = useSession()
  const [stats, setStats] = useState({
    users: null as number | null,
    records: null as number | null,
    hrvUsers: null as number | null,
    accuracy: null as number | null,
    systemStatus: null as number | null
  })
  const [loading, setLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  const formatCount = (value: number | null) =>
    value === null ? 'No disponible' : value.toLocaleString()
  const formatPercent = (value: number | null) =>
    value === null ? '—' : `${value}%`

  // Componente de loading con puntos animados
  const LoadingDots = () => (
    <div className="flex items-center space-x-1">
      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
    </div>
  )

  useEffect(() => {
    if (!session) return
    loadDashboardStats()
  }, [session?.user.id, session?.user.role])

  const loadDashboardStats = async () => {
    try {
      setLoading(true)
      setStatsError(null)

      const currentRole = session?.user.role
      const selectedUser =
        currentRole === 'user' ? (session?.user.username ?? '') : 'all'
      if (currentRole === 'user' && selectedUser.length === 0) {
        throw new Error('La sesión no incluye un nombre de usuario para consultar los datos')
      }

      const [usersResult, dataResult, hrvResult] = await Promise.allSettled([
        usersApi.count(),
        dataApi.getDecrypted({ selectedUser, timeRange: 'all' }),
        fetch('/api/kubios/team-users').then(async (response) => {
          if (!response.ok) return 0
          const payload = (await response.json()) as { users?: unknown[] }
          return Array.isArray(payload.users) ? payload.users.length : 0
        }),
      ])

      const userCount = usersResult.status === 'fulfilled' ? usersResult.value : null
      const totalRecords =
        dataResult.status === 'fulfilled'
          ? dataResult.value.insulinData.length +
            dataResult.value.foodData.length +
            dataResult.value.exerciseData.length +
            dataResult.value.periodData.length +
            dataResult.value.moodData.length
          : null

      setStats({
        users: userCount,
        records: totalRecords,
        hrvUsers: hrvResult.status === 'fulfilled' ? hrvResult.value : 0,
        accuracy: null,
        systemStatus: null
      })

      if (usersResult.status === 'rejected') {
        setStatsError(errorMessage(usersResult.reason))
      } else if (dataResult.status === 'rejected') {
        setStatsError(errorMessage(dataResult.reason))
      }
    } catch (caught) {
      console.error('Error loading dashboard stats:', caught)
      setStats({
        users: null,
        records: null,
        hrvUsers: null,
        accuracy: null,
        systemStatus: null
      })
      setStatsError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden" style={{ colorScheme: 'light' }}>
        {/* Elementos decorativos de fondo */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-1000"></div>
          <div className="absolute top-40 left-1/2 w-80 h-80 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-500"></div>
        </div>
        
        <Navigation title={`${t.dashboard.title} Dashboard`} showBackButton={false} />
        
        {/* Selector de idioma - Solo visible en desktop */}
        <div className="absolute top-6 right-6 z-50 hidden xl:block">
          <div className="bg-white/90 backdrop-blur-xl border border-white/30 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
            <LanguageSelector />
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
          {statsError && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {statsError}
            </div>
          )}
          {/* Hero Section */}
          <div className="text-center mb-20">
            <div className="inline-flex items-center space-x-3 bg-white/80 backdrop-blur-sm border border-blue-200/50 rounded-full px-8 py-4 mb-8 shadow-lg">
              <Sparkles className="h-6 w-6 text-blue-600 animate-pulse" />
              <span className="text-blue-800 font-semibold text-lg">{t.dashboard.advancedControl}</span>
            </div>
            <h1 className="text-6xl md:text-8xl font-bold bg-gradient-to-r from-blue-800 via-blue-600 to-blue-400 bg-clip-text text-transparent mb-8 leading-tight">
              {t.dashboard.title}
            </h1>
            <p className="text-2xl text-gray-700 max-w-4xl mx-auto leading-relaxed font-light">
              {t.dashboard.subtitle}
            </p>
          </div>

          {/* Tarjetas de navegación premium - Primera fila */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
            <RoleGuard requiredPermission="view_users">
              <Link href="/users" className="group">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-lg group-hover:shadow-blue-600/50 transition-all duration-300">
                      <Users className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-800 group-hover:text-blue-600 transition-colors">
                        {loading ? <LoadingDots /> : formatCount(stats.users)}
                      </div>
                      <div className="text-xs text-blue-600/70">Total</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.userManagement}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {t.dashboard.userManagementDescription}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    <span>{t.dashboard.access}</span>
                    <Zap className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>
            </RoleGuard>

            <RoleGuard requiredPermission="view_data">
              <Link href="/data" className="group">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg group-hover:shadow-blue-500/50 transition-all duration-300">
                      <Activity className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-800 group-hover:text-blue-600 transition-colors">
                        {loading ? <LoadingDots /> : formatCount(stats.records)}
                      </div>
                      <div className="text-xs text-blue-600/70">Registros</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.healthData}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {t.dashboard.healthDataDescription}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    <span>{t.dashboard.access}</span>
                    <TrendingUp className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>
            </RoleGuard>

            <RoleGuard requiredPermission="view_analytics">
              <Link href="/analytics" className="group">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-700 to-blue-800 rounded-2xl shadow-lg group-hover:shadow-blue-700/50 transition-all duration-300">
                      <BarChart3 className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-800 group-hover:text-blue-600 transition-colors">
                        {loading ? <LoadingDots /> : formatPercent(stats.accuracy)}
                      </div>
                      <div className="text-xs text-blue-600/70">Precisión</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.advancedAnalytics}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {t.dashboard.advancedAnalyticsDescription}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    <span>{t.dashboard.access}</span>
                    <BarChart3 className="h-4 w-4 ml-2 group-hover:scale-110 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>
            </RoleGuard>

            <Link href="/kubios" className="group">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-400 to-blue-500 rounded-2xl shadow-lg group-hover:shadow-blue-400/50 transition-all duration-300">
                      <Heart className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-800 group-hover:text-blue-600 transition-colors">
                        {loading ? <LoadingDots /> : formatCount(stats.hrvUsers)}
                      </div>
                      <div className="text-xs text-blue-600/70">Usuarios</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.hrvAnalysis}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {t.dashboard.hrvAnalysisDescription}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    <span>{t.dashboard.access}</span>
                    <Heart className="h-4 w-4 ml-2 group-hover:scale-110 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>

            {/* <Link href="/study" className="group">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-800 to-blue-900 rounded-2xl shadow-lg group-hover:shadow-blue-800/50 transition-all duration-300">
                      <Brain className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-800 group-hover:text-blue-600 transition-colors">AI</div>
                      <div className="text-xs text-blue-600/70">Análisis</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.correlationStudy}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {t.dashboard.correlationStudyDescription}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    <span>{t.dashboard.access}</span>
                    <Brain className="h-4 w-4 ml-2 group-hover:scale-110 transition-transform" />
                  </div>
                </div>
              </div>
            </Link> */}

            <Link href="/overview" className="group">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg group-hover:shadow-blue-500/50 transition-all duration-300">
                      <Home className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-800 group-hover:text-blue-600 transition-colors">
                        {loading ? <LoadingDots /> : formatPercent(stats.systemStatus)}
                      </div>
                      <div className="text-xs text-blue-600/70">Sistema</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.generalSummary}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {t.dashboard.advancedPlatform}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    <span>{t.dashboard.access}</span>
                    <Shield className="h-4 w-4 ml-2 group-hover:rotate-12 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>

            <RoleGuard requiredRole="admin">
            <Link href="/admin" className="group">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-lg group-hover:shadow-blue-600/50 transition-all duration-300">
                      <Settings className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-800 group-hover:text-blue-600 transition-colors">Admin</div>
                      <div className="text-xs text-blue-600/70">Panel</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.administration}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {t.dashboard.administrationDescription}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    <span>{t.dashboard.access}</span>
                    <Settings className="h-4 w-4 ml-2 group-hover:rotate-90 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>
            </RoleGuard>
          </div>

          {/* Segunda fila */}
          {/* <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
            <Link href="/admin" className="group">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-lg group-hover:shadow-blue-600/50 transition-all duration-300">
                      <Settings className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-800 group-hover:text-blue-600 transition-colors">Admin</div>
                      <div className="text-xs text-blue-600/70">Panel</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.administration}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {t.dashboard.administrationDescription}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    <span>{t.dashboard.access}</span>
                    <Settings className="h-4 w-4 ml-2 group-hover:rotate-90 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>
          </div> */}

          {/* Sección de características premium */}
          {/* <div className="relative bg-white/80 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-16 text-gray-900 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            <div className="relative z-10">
              <div className="text-center mb-16">
                <div className="inline-flex items-center space-x-3 bg-white/80 backdrop-blur-sm border border-blue-200/50 rounded-full px-8 py-4 mb-8 shadow-lg">
                  <Sparkles className="h-6 w-6 text-blue-600 animate-pulse" />
                  <span className="text-blue-800 font-semibold text-lg">{t.dashboard.cuttingEdgeTechnology}</span>
                </div>
                <h2 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-blue-800 via-blue-600 to-blue-400 bg-clip-text text-transparent mb-8">
                  {t.dashboard.intelligentMonitoring}
                </h2>
                <p className="text-2xl text-gray-700 max-w-4xl mx-auto leading-relaxed font-light">
                  {t.dashboard.advancedPlatform}
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                <div className="group bg-white/90 backdrop-blur-sm border border-gray-200/50 rounded-3xl p-10 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-500/10">
                  <div className="p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl w-fit mb-8 group-hover:scale-110 transition-transform duration-300">
                    <Shield className="h-10 w-10 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold mb-6 text-gray-900 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.advancedSecurity}
                  </h3>
                  <p className="text-gray-600 leading-relaxed mb-8 text-lg">
                    {t.dashboard.endToEndEncryption}
                  </p>
                  <div className="flex items-center text-blue-600 text-base font-medium">
                    <span>{t.dashboard.moreInformation}</span>
                    <Zap className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                <div className="group bg-white/90 backdrop-blur-sm border border-gray-200/50 rounded-3xl p-10 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-500/10">
                  <div className="p-5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl w-fit mb-8 group-hover:scale-110 transition-transform duration-300">
                    <TrendingUp className="h-10 w-10 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold mb-6 text-gray-900 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.predictiveAnalysis}
                  </h3>
                  <p className="text-gray-600 leading-relaxed mb-8 text-lg">
                    {t.dashboard.machineLearningAlgorithms}
                  </p>
                  <div className="flex items-center text-blue-600 text-base font-medium">
                    <span>{t.dashboard.exploreAI}</span>
                    <Activity className="h-5 w-5 ml-2 group-hover:scale-110 transition-transform" />
                  </div>
                </div>

                <div className="group bg-white/90 backdrop-blur-sm border border-gray-200/50 rounded-3xl p-10 hover:border-blue-300/70 transition-all duration-300 transform hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-500/10">
                  <div className="p-5 bg-gradient-to-br from-blue-400 to-blue-500 rounded-2xl w-fit mb-8 group-hover:scale-110 transition-transform duration-300">
                    <Heart className="h-10 w-10 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold mb-6 text-gray-900 group-hover:text-blue-700 transition-colors">
                    {t.dashboard.continuousMonitoring}
                  </h3>
                  <p className="text-gray-600 leading-relaxed mb-8 text-lg">
                    {t.dashboard.tracking24_7}
                  </p>
                  <div className="flex items-center text-blue-600 text-base font-medium">
                    <span>{t.dashboard.viewMetrics}</span>
                    <BarChart3 className="h-5 w-5 ml-2 group-hover:rotate-12 transition-transform" />
                  </div>
                </div>
              </div>
            </div>
          </div> */}
        </div>
      </div>
    </ProtectedRoute>
  )
}
