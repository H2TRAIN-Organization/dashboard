'use client'

import { useState, useEffect } from 'react'
import { Database, Shield, Users, Activity, TrendingUp, CheckCircle } from 'lucide-react'
import HybridProtectedRoute from '@/components/HybridProtectedRoute'
import HybridRoleGuard from '@/components/HybridRoleGuard'
import HybridNavigation from '@/components/HybridNavigation'
import { adminApi, errorMessage, usersApi } from '@/lib/api-client'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import LanguageSelector from '@/components/LanguageSelector'
import Link from 'next/link'

export default function AdminNewPage() {
  const { t } = useLanguage()
  const { session } = useSession()
  
  const [statsError, setStatsError] = useState<string | null>(null)
  const [stats, setStats] = useState({
    totalUsers: null as number | null,
    totalRecords: null as number | null,
    databaseSize: null as number | null,
    systemUptime: null as number | null
  })

  useEffect(() => {
    if (session?.user.role !== 'admin') return
    const loadStats = async () => {
      try {
        setStatsError(null)

        const [usersResult, tablesResult] = await Promise.allSettled([
          usersApi.count(),
          adminApi.listTables(),
        ])

        setStats({
          totalUsers: usersResult.status === 'fulfilled' ? usersResult.value : null,
          totalRecords: tablesResult.status === 'fulfilled' ? tablesResult.value.totalRecords : null,
          databaseSize: null,
          systemUptime: null
        })

        if (usersResult.status === 'rejected') {
          setStatsError(errorMessage(usersResult.reason))
        } else if (tablesResult.status === 'rejected') {
          setStatsError(errorMessage(tablesResult.reason))
        }
      } catch (caught) {
        console.error('Error loading stats:', caught)
        setStats({
          totalUsers: null,
          totalRecords: null,
          databaseSize: null,
          systemUptime: null
        })
        setStatsError(errorMessage(caught))
      }
    }

    loadStats()
  }, [session])

  const adminFeatures = [
    {
      title: t.admin.database,
      description: t.admin.databaseDescription,
      icon: Database,
      href: '/admin/database',
      color: 'from-green-500 to-emerald-500',
      stats: stats.totalRecords === null
        ? 'No disponible'
        : `${stats.totalRecords.toLocaleString()} ${t.admin.records}`
     }
  ]

  const formatCount = (value: number | null) =>
    value === null ? 'No disponible' : value.toLocaleString()

  return (
    <HybridProtectedRoute>
      <HybridRoleGuard requiredRole="admin">
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden" style={{ colorScheme: 'light' }}>
        {/* Elementos decorativos de fondo */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-1000"></div>
          <div className="absolute top-40 left-1/2 w-80 h-80 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-500"></div>
        </div>
        
        <HybridNavigation title={t.dashboard.administration} showBackButton={true} />
        
        {/* Selector de idioma */}
        <div className="absolute top-6 right-6 z-20">
          <LanguageSelector />
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
          {statsError && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {statsError}
            </div>
          )}
          {/* Header con estadísticas generales */}
          <div className="mb-12">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10">
              <div className="text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start mb-6">
                  <div className="p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-lg">
                    <Shield className="h-12 w-12 text-white" />
                  </div>
                  <div className="ml-6">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">{t.dashboard.administration}</h1>
                    <p className="text-gray-600 text-lg">{t.admin.description}</p>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-4 mt-6 sm:mt-0">
                <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl px-6 py-4 shadow-lg">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Users className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">{t.admin.usersLabel}</p>
                      <p className="text-2xl font-bold text-gray-900">{formatCount(stats.totalUsers)}</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl px-6 py-4 shadow-lg">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <Database className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">{t.admin.recordsLabel}</p>
                      <p className="text-2xl font-bold text-gray-900">{formatCount(stats.totalRecords)}</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl px-6 py-4 shadow-lg">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <Activity className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">{t.admin.uptimeLabel}</p>
                      <p className="text-2xl font-bold text-gray-900">{stats.systemUptime === null ? 'No disponible' : `${stats.systemUptime}%`}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Funcionalidades de administración */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
            {adminFeatures.map((feature, index) => (
              <Link
                key={index}
                href={feature.href}
                className="group relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 overflow-hidden shadow-2xl hover:shadow-3xl transition-all duration-500 transform hover:-translate-y-2 hover:scale-105"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
                <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className={`p-4 bg-gradient-to-br ${feature.color} rounded-2xl shadow-lg group-hover:shadow-xl transition-all duration-300 transform group-hover:scale-110`}>
                      <feature.icon className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500 font-medium">{feature.stats}</p>
                    </div>
                  </div>
                  
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-600 transition-colors duration-300">
                    {feature.title}
                  </h3>
                  
                  <p className="text-gray-600 leading-relaxed mb-4">
                    {feature.description}
                  </p>
                  
                  <div className="flex items-center text-blue-600 font-semibold group-hover:text-blue-700 transition-colors duration-300">
                    <span>{t.admin.access}</span>
                    <TrendingUp className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Sección de estado del sistema */}
          <div className="bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl shadow-lg">
                  <CheckCircle className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{t.admin.systemStatus}</h3>
                  <p className="text-gray-600">{t.admin.realTimeMonitoring}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full animate-pulse ${statsError ? 'bg-gray-400' : 'bg-green-500'}`}></div>
                <span className={`font-semibold ${statsError ? 'text-gray-500' : 'text-green-600'}`}>
                  {statsError ? 'No disponible' : t.admin.operational}
                </span>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-blue-500 rounded-lg">
                    <Database className="h-5 w-5 text-white" />
                  </div>
                <span className="text-2xl font-bold text-blue-600">{stats.databaseSize === null ? 'No disponible' : `${stats.databaseSize} GB`}</span>
                </div>
                <p className="text-blue-700 font-medium">{t.admin.databaseSize}</p>
              </div>
              
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-green-500 rounded-lg">
                    <Activity className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-2xl font-bold text-green-600">{stats.systemUptime === null ? 'No disponible' : `${stats.systemUptime}%`}</span>
                </div>
                <p className="text-green-700 font-medium">{t.admin.uptime}</p>
              </div>
              
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-purple-500 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-2xl font-bold text-purple-600">{formatCount(stats.totalRecords)}</span>
                </div>
                <p className="text-purple-700 font-medium">{t.admin.totalRecords}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      </HybridRoleGuard>
    </HybridProtectedRoute>
  )
}
