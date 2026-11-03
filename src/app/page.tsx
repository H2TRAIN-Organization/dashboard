'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  BarChart3,
  BookOpen,
  Home,
  Settings,
  Sparkles,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import Navigation from '@/components/Navigation'
import KubiosSummaryCard from '@/components/kubios/KubiosSummaryCard'
import { dataApi, errorMessage, usersApi } from '@/lib/api-client'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { hasPermission } from '@/lib/permissions'

function LoadingDots() {
  return (
    <span className="inline-flex items-center space-x-1" aria-hidden="true">
      <span className="h-2 w-2 animate-bounce rounded-full bg-blue-600"></span>
      <span className="h-2 w-2 animate-bounce rounded-full bg-blue-600" style={{ animationDelay: '150ms' }}></span>
      <span className="h-2 w-2 animate-bounce rounded-full bg-blue-600" style={{ animationDelay: '300ms' }}></span>
    </span>
  )
}

interface StatsState {
  users: number | null
  records: number | null
}

interface MetricBlock {
  key: 'users' | 'records'
  label: string
}

interface HomeOption {
  href: string
  title: string
  description: string
  action: string
  icon: LucideIcon
  iconClass: string
  accentClass: string
  metric?: MetricBlock
}

export default function DashboardPage() {
  const { t, language } = useLanguage()
  const { session } = useSession()
  const [stats, setStats] = useState<StatsState>({ users: null, records: null })
  const [loading, setLoading] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)

  const role = session?.user.role ?? null
  const username = session?.user.username ?? ''
  const canViewUsers = role !== null && hasPermission(role, 'view_users')
  const canViewData = role !== null && hasPermission(role, 'view_data')
  const canViewAnalytics = role !== null && hasPermission(role, 'view_analytics')
  const canViewStudy = role !== null && hasPermission(role, 'view_study')
  const canViewAdmin = role !== null && hasPermission(role, 'view_admin')
  const canViewOverview = role === 'admin' || role === 'doctor'

  useEffect(() => {
    if (role === null) return
    let cancelled = false

    const loadDashboardStats = async () => {
      await Promise.resolve()
      if (cancelled) return

      try {
        setLoading(true)
        setStatsError(null)

        const needsOwnUsername = role === 'user' && username.length === 0
        const dataRequest = canViewData && !needsOwnUsername
          ? dataApi.getDecrypted({
              selectedUser: role === 'user' ? username : 'all',
              timeRange: 'all',
            })
          : Promise.resolve(null)

        const [usersResult, dataResult] = await Promise.allSettled([
          canViewUsers ? usersApi.count() : Promise.resolve(null),
          dataRequest,
        ])

        if (cancelled) return

        const userCount =
          usersResult.status === 'fulfilled' ? usersResult.value : null
        const totalRecords =
          dataResult.status === 'fulfilled' && dataResult.value !== null
            ? dataResult.value.insulinData.length +
              dataResult.value.foodData.length +
              dataResult.value.exerciseData.length +
              dataResult.value.periodData.length +
              dataResult.value.moodData.length
            : null

        setStats({ users: userCount, records: totalRecords })

        const failures = [usersResult, dataResult].filter(
          (result) => result.status === 'rejected',
        )
        if (failures.length > 0) {
          setStatsError(errorMessage(failures[0]?.reason))
        } else if (needsOwnUsername) {
          setStatsError(t.auth.sessionMissingUsername)
        }
      } catch (caught) {
        if (cancelled) return
        setStats({ users: null, records: null })
        setStatsError(errorMessage(caught))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadDashboardStats()
    return () => {
      cancelled = true
    }
  }, [
    canViewData,
    canViewUsers,
    role,
    t.auth.sessionMissingUsername,
    username,
  ])

  const formatCount = (value: number | null): string | null => {
    if (value === null) return null
    return value.toLocaleString(language === 'en' ? 'en-US' : 'es-ES')
  }

  const recordsLabel = formatCount(stats.records)
  const usersLabel = formatCount(stats.users)

  const options: HomeOption[] = [
    ...(canViewUsers
      ? [
          {
            href: '/users',
            title: t.dashboard.userManagement,
            description: t.dashboard.userManagementDescription,
            action: t.dashboard.access,
            icon: Users,
            iconClass: 'from-blue-600 to-blue-700',
            accentClass: 'hover:border-blue-300/70',
            metric: { key: 'users' as const, label: t.dashboard.total },
          },
        ]
      : []),
    ...(canViewData
      ? [
          {
            href: '/data',
            title: t.dashboard.healthData,
            description: t.dashboard.healthDataDescription,
            action: t.dashboard.access,
            icon: Activity,
            iconClass: 'from-blue-500 to-blue-600',
            accentClass: 'hover:border-blue-300/70',
            metric: { key: 'records' as const, label: t.dashboard.records },
          },
        ]
      : []),
    ...(canViewAnalytics
      ? [
          {
            href: '/analytics',
            title: t.dashboard.advancedAnalytics,
            description: t.dashboard.advancedAnalyticsDescription,
            action: t.dashboard.access,
            icon: BarChart3,
            iconClass: 'from-blue-700 to-blue-800',
            accentClass: 'hover:border-blue-300/70',
          },
        ]
      : []),
    ...(canViewOverview
      ? [
          {
            href: '/overview',
            title: t.dashboard.generalSummary,
            description: t.dashboard.advancedPlatform,
            action: t.dashboard.access,
            icon: Home,
            iconClass: 'from-blue-500 to-blue-600',
            accentClass: 'hover:border-blue-300/70',
          },
        ]
      : []),
    ...(canViewStudy
      ? [
          {
            href: '/study',
            title: t.navigation.study,
            description: t.study.pageSubtitle,
            action: t.dashboard.access,
            icon: BookOpen,
            iconClass: 'from-indigo-600 to-indigo-700',
            accentClass: 'hover:border-indigo-300/70',
          },
        ]
      : []),
    ...(canViewAdmin
      ? [
          {
            href: '/admin',
            title: t.dashboard.administration,
            description: t.dashboard.administrationDescription,
            action: t.dashboard.access,
            icon: Settings,
            iconClass: 'from-red-600 to-red-700',
            accentClass: 'hover:border-red-300/70',
          },
        ]
      : []),
  ]

  return (
    <ProtectedRoute>
      <div
        className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50"
        style={{ colorScheme: 'light' }}
      >
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-400 opacity-10 mix-blend-multiply blur-xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-indigo-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-1000"></div>
          <div className="absolute left-1/2 top-40 h-80 w-80 rounded-full bg-purple-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-500"></div>
        </div>

        <Navigation title={t.dashboard.title} showBackButton={false} />

        <main className="relative z-10 mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          {statsError && (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
            >
              {statsError}
            </div>
          )}

          <div className="mb-20 text-center">
            <div className="mb-8 inline-flex items-center space-x-3 rounded-full border border-blue-200/50 bg-white/80 px-8 py-4 shadow-lg backdrop-blur-sm">
              <Sparkles className="h-6 w-6 text-blue-600 animate-pulse" />
              <span className="text-lg font-semibold text-blue-800">
                {role === 'user' ? t.dashboard.healthMonitoring : t.dashboard.advancedControl}
              </span>
            </div>
            <h1 className="mb-8 bg-gradient-to-r from-blue-800 via-blue-600 to-blue-400 bg-clip-text text-6xl font-bold leading-tight text-transparent md:text-8xl">
              {t.dashboard.title}
            </h1>
            <p className="mx-auto max-w-4xl text-2xl font-light leading-relaxed text-gray-700">
              {role === 'user' ? t.dashboard.analyzeData : t.dashboard.manageUsers}
            </p>
          </div>

          <div className="mb-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
            {options.map((option) => (
              <HomeOptionCard
                key={option.href}
                option={option}
                loading={loading}
                formattedMetric={
                  option.metric?.key === 'users' ? usersLabel : recordsLabel
                }
              />
            ))}
            <KubiosSummaryCard />
          </div>
        </main>
      </div>
    </ProtectedRoute>
  )
}

function HomeOptionCard({
  option,
  loading,
  formattedMetric,
}: {
  option: HomeOption
  loading: boolean
  formattedMetric: string | null
}) {
  const Icon = option.icon
  const showMetric = option.metric !== undefined
  const hasValue = formattedMetric !== null

  return (
    <Link href={option.href} className="group block">
      <div
        className={`relative h-full transform rounded-3xl border border-gray-200/50 bg-white/90 p-8 shadow-sm backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10 ${option.accentClass}`}
      >
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-500/5 to-blue-600/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
        <div className="relative z-10">
          <div className="mb-6 flex items-center justify-between">
            <div
              className={`rounded-2xl bg-gradient-to-br p-4 shadow-lg transition-all duration-300 ${option.iconClass}`}
            >
              <Icon className="h-8 w-8 text-white" />
            </div>
            {showMetric && (loading || hasValue) && (
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-800 transition-colors group-hover:text-blue-600">
                  {loading ? <LoadingDots /> : formattedMetric}
                </div>
                <div className="text-xs text-blue-600/70">
                  {option.metric?.label}
                </div>
              </div>
            )}
          </div>
          <h2 className="mb-3 text-xl font-bold text-gray-900 transition-colors group-hover:text-blue-700">
            {option.title}
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-gray-600">
            {option.description}
          </p>
          <div className="flex items-center text-sm font-medium text-blue-600">
            <span>{option.action}</span>
            <Zap className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </Link>
  )
}
