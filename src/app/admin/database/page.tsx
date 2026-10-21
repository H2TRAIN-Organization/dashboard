'use client'

import { useState, useEffect } from 'react'
import { Database, Table, Download, Upload, RefreshCw, FileText, HardDrive, Activity, TrendingUp, CheckCircle, Clock, Database as DatabaseIcon } from 'lucide-react'
import HybridProtectedRoute from '@/components/HybridProtectedRoute'
import HybridRoleGuard from '@/components/HybridRoleGuard'
import HybridNavigation from '@/components/HybridNavigation'
import type { AdminTableInfo } from '@/lib/api-types'
import { adminApi, errorMessage } from '@/lib/api-client'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'
import LanguageSelector from '@/components/LanguageSelector'

export default function AdminDatabasePage() {
  const { t } = useLanguage()
  const { session } = useSession()
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dbStats, setDbStats] = useState({
    totalTables: null as number | null,
    totalRecords: null as number | null,
    databaseSize: null as number | null,
    lastBackup: null as string | null,
    uptime: null as number | null
  })

  const [tables, setTables] = useState<AdminTableInfo[]>([])

  useEffect(() => {
    if (session?.user.role !== 'admin') return
    const loadDbStats = async () => {
      try {
        setLoading(true)
        setError(null)

        const result = await adminApi.listTables()
        setTables(result.tables)
        setDbStats({
          totalTables: result.totalCount,
          totalRecords: result.totalRecords,
          databaseSize: null,
          lastBackup: null,
          uptime: null
        })
      } catch (caught) {
        console.error('Error loading database stats:', caught)
        setError(errorMessage(caught))
        setDbStats({
          totalTables: null,
          totalRecords: null,
          databaseSize: null,
          lastBackup: null,
          uptime: null
        })
      } finally {
        setLoading(false)
      }
    }

    loadDbStats()
  }, [session])

  const formatCount = (value: number | null) =>
    value === null ? 'No disponible' : value.toLocaleString()

  const databaseFeatures = [
    {
      title: t.admin.tableExplorer,
      description: 'Explorar y visualizar todas las tablas de la base de datos',
      icon: Table,
      color: 'from-blue-500 to-cyan-500',
      stats: dbStats.totalTables === null ? 'No disponible' : `${dbStats.totalTables} tablas`
    },
    {
      title: t.admin.exportData,
      description: 'Exportar datos en formato JSON o CSV',
      icon: Download,
      color: 'from-green-500 to-emerald-500',
      stats: dbStats.totalRecords === null ? 'No disponible' : `${dbStats.totalRecords.toLocaleString()} registros`
    },
    {
      title: t.admin.createBackup,
      description: 'Crear respaldo completo de la base de datos',
      icon: Upload,
      color: 'from-purple-500 to-pink-500',
      stats: 'No disponible'
    },
    {
      title: t.admin.refreshStats,
      description: 'Actualizar estadísticas y métricas del sistema',
      icon: RefreshCw,
      color: 'from-orange-500 to-red-500',
      stats: 'No disponible'
    }
  ]

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
        
        <HybridNavigation title={t.admin.databaseManagement} showBackButton={true} />
        
        {/* Selector de idioma */}
        <div className="absolute top-6 right-6 z-20">
          <LanguageSelector />
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}
          {/* Header con estadísticas generales */}
          <div className="mb-12">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10">
              <div className="text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start mb-6">
                  <div className="p-5 bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl shadow-lg">
                    <DatabaseIcon className="h-12 w-12 text-white" />
                  </div>
                  <div className="ml-6">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">{t.admin.databaseManagement}</h1>
                    <p className="text-gray-600 text-lg">{t.admin.databaseDescription}</p>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-4 mt-6 sm:mt-0">
                <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl px-6 py-4 shadow-lg">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Table className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">{t.admin.tables}</p>
                      <p className="text-2xl font-bold text-gray-900">{formatCount(dbStats.totalTables)}</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl px-6 py-4 shadow-lg">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <FileText className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">{t.admin.records}</p>
                      <p className="text-2xl font-bold text-gray-900">{formatCount(dbStats.totalRecords)}</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl px-6 py-4 shadow-lg">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <HardDrive className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">{t.admin.databaseSize}</p>
                      <p className="text-2xl font-bold text-gray-900">No disponible</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Funcionalidades de base de datos */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
            {databaseFeatures.map((feature, index) => (
              <div
                key={index}
                className="group relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 overflow-hidden shadow-2xl hover:shadow-3xl transition-all duration-500 transform hover:-translate-y-2 hover:scale-105 cursor-pointer"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-emerald-600/5"></div>
                <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className={`p-4 bg-gradient-to-br ${feature.color} rounded-2xl shadow-lg group-hover:shadow-xl transition-all duration-300 transform group-hover:scale-110`}>
                      <feature.icon className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500 font-medium">{feature.stats}</p>
                    </div>
                  </div>
                  
                  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-green-600 transition-colors duration-300">
                    {feature.title}
                  </h3>
                  
                  <p className="text-gray-600 leading-relaxed mb-4">
                    {feature.description}
                  </p>
                  
                  <div className="flex items-center text-green-600 font-semibold group-hover:text-green-700 transition-colors duration-300">
                    <span>{t.admin.access}</span>
                    <TrendingUp className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Tablas de la base de datos */}
          <div className="bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 shadow-2xl mb-12">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl shadow-lg">
                  <Table className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{t.admin.tables}</h3>
                  <p className="text-gray-600">{t.admin.tableStructure}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full animate-pulse ${error ? 'bg-gray-400' : 'bg-green-500'}`}></div>
                <span className={`font-semibold ${error ? 'text-gray-500' : 'text-green-600'}`}>
                  {error ? 'No disponible' : t.admin.operational}
                </span>
              </div>
            </div>
            
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="text-gray-600 font-medium">Cargando tablas...</span>
                </div>
              </div>
            ) : tables.length === 0 ? (
              <div className="py-16 text-center text-gray-600 font-medium">
                No disponible
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tables.map((table) => (
                <div key={table.name} className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 hover:shadow-lg transition-all duration-300">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 bg-blue-500 rounded-lg">
                      <Database className="h-5 w-5 text-white" />
                    </div>
                    <span className={`text-sm font-medium ${table.accessible ? 'text-green-600' : 'text-gray-500'}`}>
                      {table.accessible ? t.admin.operational : 'No disponible'}
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-gray-900 mb-2">{table.name}</h4>
                  <p className="text-gray-600 text-sm">
                    {table.accessible
                      ? `${table.recordCount.toLocaleString()} ${t.admin.records}`
                      : 'No disponible'}
                  </p>
                </div>
              ))}
            </div>
            )}
          </div>

          {/* Estado del sistema */}
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
                <div className={`w-3 h-3 rounded-full animate-pulse ${error ? 'bg-gray-400' : 'bg-green-500'}`}></div>
                <span className={`font-semibold ${error ? 'text-gray-500' : 'text-green-600'}`}>
                  {error ? 'No disponible' : t.admin.operational}
                </span>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-blue-500 rounded-lg">
                    <HardDrive className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-2xl font-bold text-blue-600">No disponible</span>
                </div>
                <p className="text-blue-700 font-medium">{t.admin.databaseSize}</p>
              </div>
              
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-green-500 rounded-lg">
                    <Activity className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-2xl font-bold text-green-600">No disponible</span>
                </div>
                <p className="text-green-700 font-medium">{t.admin.uptime}</p>
              </div>
              
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-purple-500 rounded-lg">
                    <Clock className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-2xl font-bold text-purple-600">No disponible</span>
                </div>
                <p className="text-purple-700 font-medium">{t.admin.lastBackup}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      </HybridRoleGuard>
    </HybridProtectedRoute>
  )
}
