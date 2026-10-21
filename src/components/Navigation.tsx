'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSession } from '@/contexts/SessionContext'
import { useRouter } from 'next/navigation'
import { ArrowLeft, LogOut, User, Sparkles, Shield, Stethoscope, Menu, X } from 'lucide-react'
import { usePermissions } from '@/components/RoleGuard'
import { useLanguage } from '@/contexts/LanguageContext'
import LanguageSelector from './LanguageSelector'

interface NavigationProps {
  title: string
  showBackButton?: boolean
}

export default function Navigation({ title, showBackButton = true }: NavigationProps) {
  const { t } = useLanguage()
  const { session, logout } = useSession()
  const user = session?.user ?? null
  const { userRole, hasPermission } = usePermissions()
  const router = useRouter()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const handleSignOut = async () => {
    const destination = session?.method === 'username' ? '/app-login' : '/login'
    await logout()
    router.push(destination)
  }

  // Rutas de navegación
  const navigationRoutes = [
    { path: '/', label: t.navigation.dashboard, icon: '🏠' },
    { path: '/users', label: t.navigation.users, icon: '👥', requiresPermission: 'view_users' },
    { path: '/data', label: t.navigation.data, icon: '📊' },
    { path: '/kubios', label: t.navigation.kubios, icon: '❤️' },
    { path: '/analytics', label: t.navigation.analytics, icon: '📈' },
    { path: '/admin', label: t.navigation.admin, icon: '⚙️', requiresPermission: 'view_admin' },
  ].filter(route => !route.requiresPermission || hasPermission(route.requiresPermission))

  return (
    <div className="relative bg-gradient-to-r from-blue-600/95 via-blue-700/95 to-blue-800/95 backdrop-blur-xl border-b border-blue-200/30 z-50">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-blue-600/10 to-blue-700/10"></div>
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%230066CC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%221%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-30"></div>
      
      <div className="relative z-10 max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
        {/* Header Móvil - Logo Grande + Fila Inferior */}
        <div className="lg:hidden py-4">
          {/* Primera fila - Solo logo grande */}
          <div className="flex justify-center mb-4">
            <Image
              src="/logo-horizontal.png"
              alt="H2TRAIN Logo"
              width={1050}
              height={425}
              className="h-16 w-auto rounded-xl shadow-xl"
              style={{ maxWidth: '300px', maxHeight: '64px' }}
            />
          </div>
          
          {/* Segunda fila - Menú, título y acciones */}
          <div className="flex items-center justify-between space-x-1">
            {/* Botón del menú - Izquierda */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="flex items-center justify-center w-8 h-8 bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 rounded-lg transition-all duration-200 hover:scale-105"
            >
              {isMobileMenuOpen ? (
                <X className="h-4 w-4 text-white" />
              ) : (
                <Menu className="h-4 w-4 text-white" />
              )}
            </button>
            
            {/* Título - Centro */}
            <div className="flex-1 text-center mx-2">
              <h1 className="text-sm font-bold text-white truncate">{title}</h1>
            </div>
            
            {/* Acciones - Derecha */}
            <div className="flex items-center space-x-0.5 flex-shrink-0">
              {/* Selector de idioma */}
              <LanguageSelector compact={true} />
              
              {/* Botón de logout */}
              <button
                onClick={handleSignOut}
                className="group flex items-center justify-center w-8 h-8 bg-gradient-to-r from-blue-500/20 to-blue-600/20 backdrop-blur-sm border border-blue-400/40 rounded-lg text-white hover:border-blue-300/60 hover:from-blue-500/30 hover:to-blue-600/30 transition-all duration-300 transform hover:scale-105"
              >
                <LogOut className="h-4 w-4 group-hover:rotate-12 transition-transform duration-300" />
              </button>
            </div>
          </div>
        </div>

        {/* Menú Móvil Desplegable */}
        {isMobileMenuOpen && (
          <div className="lg:hidden absolute top-full left-0 right-0 bg-white/95 backdrop-blur-xl border-b border-blue-200/30 shadow-xl z-[99999]">
            <div className="px-4 py-3">
              {/* Información del usuario */}
              <div className="flex items-center space-x-3 mb-4 p-3 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg">
                <div className="relative">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-blue-500 rounded-full flex items-center justify-center shadow-lg">
                    <User className="h-5 w-5 text-white" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-gradient-to-r from-blue-300 to-blue-400 rounded-full border border-blue-600"></div>
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-800">{user?.email || user?.username}</p>
                  <div className="flex items-center space-x-1">
                    {userRole === 'admin' && <Shield className="h-3 w-3 text-yellow-500" />}
                    {userRole === 'doctor' && <Stethoscope className="h-3 w-3 text-green-500" />}
                    {userRole === 'user' && <User className="h-3 w-3 text-blue-500" />}
                    <p className="text-gray-600 text-sm capitalize">
                      {userRole === 'admin' && 'Administrador'}
                      {userRole === 'doctor' && 'Médico'}
                      {userRole === 'user' && 'Usuario'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Enlaces de navegación */}
              <div className="space-y-1">
                {navigationRoutes.map((route) => (
                  <Link
                    key={route.path}
                    href={route.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center space-x-3 px-3 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-all duration-200 hover:scale-105"
                  >
                    <span className="text-xl">{route.icon}</span>
                    <span className="font-medium">{route.label}</span>
                  </Link>
                ))}
              </div>

              {/* Botón de cerrar sesión */}
              <div className="mt-4 pt-3 border-t border-gray-200">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false)
                    handleSignOut()
                  }}
                  className="flex items-center space-x-3 w-full px-3 py-3 text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="font-medium">{t.dashboard.logout}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header Desktop - Original */}
        <div className="hidden lg:flex lg:justify-between lg:items-center py-4 xl:py-6">
          {/* Sección izquierda - Logo y título */}
          <div className="flex items-center space-x-4 xl:space-x-6">
            {showBackButton && (
              <Link href="/" className="group flex-shrink-0">
                <div className="relative bg-gradient-to-r from-blue-500 to-blue-600 p-3 rounded-2xl shadow-lg group-hover:shadow-blue-500/50 transition-all duration-300 transform group-hover:scale-110">
                  <ArrowLeft className="h-6 w-6 text-white group-hover:h-7 group-hover:w-7 transition-all duration-300 relative z-10" />
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400/30 to-blue-500/30 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>
              </Link>
            )}
            <div className="flex items-center space-x-4 xl:space-x-6 min-w-0 flex-1">
              {/* Logo H2TRAIN - Desktop */}
              <div className="flex-shrink-0">
                <Image
                  src="/logo-horizontal.png"
                  alt="H2TRAIN Logo"
                  width={1050}
                  height={425}
                  className="h-16 xl:h-20 w-auto rounded-xl shadow-xl"
                  style={{ maxWidth: '300px', maxHeight: '48px' }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl xl:text-2xl font-bold text-white truncate">
                  {title}
                </h1>
                <div className="flex items-center space-x-2 mt-0.5">
                  <Sparkles className="h-2 w-2 text-blue-200 animate-pulse flex-shrink-0" />
                  <span className="text-xs text-blue-100/80 font-medium truncate">{t.dashboard.advancedSystem}</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Sección derecha - Usuario, idioma y logout */}
          <div className="flex items-center space-x-2">
            {/* Información del usuario - Desktop */}
            <div className="flex items-center space-x-2 bg-gradient-to-r from-white/20 to-white/10 backdrop-blur-sm border border-white/30 px-3 py-2 rounded-xl hover:border-white/40 transition-all duration-300 min-w-0 flex-shrink-0">
              <div className="relative flex-shrink-0">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-400 to-blue-500 rounded-full flex items-center justify-center shadow-lg">
                  <User className="h-4 w-4 text-white" />
                </div>
                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-gradient-to-r from-blue-300 to-blue-400 rounded-full border border-blue-600"></div>
              </div>
              <div className="text-sm min-w-0 flex-1">
                <p className="font-medium text-white truncate">{user?.email || user?.username}</p>
                <div className="flex items-center space-x-1">
                  {userRole === 'admin' && <Shield className="h-3 w-3 text-yellow-300 flex-shrink-0" />}
                  {userRole === 'doctor' && <Stethoscope className="h-3 w-3 text-green-300 flex-shrink-0" />}
                  {userRole === 'user' && <User className="h-3 w-3 text-blue-200 flex-shrink-0" />}
                  <p className="text-blue-100/80 text-sm capitalize truncate">
                    {userRole === 'admin' && 'Administrador'}
                    {userRole === 'doctor' && 'Médico'}
                    {userRole === 'user' && 'Usuario'}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Botón de logout - Desktop */}
            <button
              onClick={handleSignOut}
              className="group flex items-center space-x-2 bg-gradient-to-r from-blue-500/20 to-blue-600/20 backdrop-blur-sm border border-blue-400/40 px-4 py-2 rounded-xl text-white hover:border-blue-300/60 hover:from-blue-500/30 hover:to-blue-600/30 transition-all duration-300 transform hover:scale-105 flex-shrink-0"
            >
              <LogOut className="h-4 w-4 group-hover:rotate-12 transition-transform duration-300" />
              <span className="font-medium text-sm">{t.dashboard.logout}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
