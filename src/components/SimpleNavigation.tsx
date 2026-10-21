'use client'

import { useSession } from '@/contexts/SessionContext'
import { useRouter } from 'next/navigation'
import { ArrowLeft, LogOut, User, Sparkles, Shield, Stethoscope, UserIcon } from 'lucide-react'
import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'

interface SimpleNavigationProps {
  title: string
  showBackButton?: boolean
}

export default function SimpleNavigation({ title, showBackButton = true }: SimpleNavigationProps) {
  const { t } = useLanguage()
  const { session, logout } = useSession()
  const user = session?.user ?? null
  const userRole = user?.role ?? null
  const router = useRouter()

  const handleSignOut = async () => {
    const destination = session?.method === 'username' ? '/app-login' : '/login'
    await logout()
    router.push(destination)
  }

  const backHref = session?.method === 'username' ? '/app-dashboard' : '/'

  return (
    <div className="relative bg-gradient-to-r from-blue-600/95 via-blue-700/95 to-blue-800/95 backdrop-blur-xl border-b border-blue-200/30">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-blue-600/10 to-blue-700/10"></div>
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%230066CC%22%20fill-opacity%3D%220.1%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%221%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-30"></div>
      
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-6">
          <div className="flex items-center space-x-6">
            {showBackButton && (
              <Link href={backHref} className="group">
                <div className="relative bg-gradient-to-r from-blue-500 to-blue-600 p-3 rounded-2xl shadow-lg group-hover:shadow-blue-500/50 transition-all duration-300 transform group-hover:scale-110">
                  <ArrowLeft className="h-6 w-6 text-white group-hover:h-7 group-hover:w-7 transition-all duration-300 relative z-10" />
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400/30 to-blue-500/30 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>
              </Link>
            )}
            <div className="flex items-center space-x-6">
              {/* Logo H2TRAIN - Logo horizontal, muy grande */}
              <img 
                src="/logo-horizontal.png" 
                alt="H2TRAIN Logo" 
                className="h-16 w-auto rounded-xl shadow-xl"
                style={{ maxWidth: '300px', maxHeight: '64px' }}
              />
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white">
                  {title}
                </h1>
                <div className="flex items-center space-x-2 mt-1">
                  <Sparkles className="h-3 w-3 text-blue-200 animate-pulse" />
                  <span className="text-xs text-blue-100/80 font-medium">{t.dashboard.advancedSystem}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-4 bg-gradient-to-r from-white/20 to-white/10 backdrop-blur-sm border border-white/30 px-6 py-3 rounded-2xl hover:border-white/40 transition-all duration-300">
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-blue-500 rounded-full flex items-center justify-center shadow-lg">
                  <User className="h-5 w-5 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-r from-blue-300 to-blue-400 rounded-full border-2 border-blue-600"></div>
              </div>
              <div className="text-sm">
                <p className="font-semibold text-white">
                  {user?.email || user?.username}
                </p>
                <div className="flex items-center space-x-1">
                  {userRole === 'admin' && <Shield className="h-3 w-3 text-yellow-300" />}
                  {userRole === 'doctor' && <Stethoscope className="h-3 w-3 text-green-300" />}
                  {userRole === 'user' && <UserIcon className="h-3 w-3 text-blue-200" />}
                  <p className="text-blue-100/80 text-xs capitalize">
                    {userRole === 'admin' && 'Administrador'}
                    {userRole === 'doctor' && 'Médico'}
                    {userRole === 'user' && 'Usuario'}
                  </p>
                </div>
              </div>
            </div>
            
            <button
              onClick={handleSignOut}
              className="group flex items-center space-x-2 bg-gradient-to-r from-blue-500/20 to-blue-600/20 backdrop-blur-sm border border-blue-400/40 px-4 py-2 rounded-xl text-white hover:border-blue-300/60 hover:from-blue-500/30 hover:to-blue-600/30 transition-all duration-300 transform hover:scale-105"
            >
              <LogOut className="h-4 w-4 group-hover:rotate-12 transition-transform duration-300" />
              <span className="hidden sm:inline font-medium">{t.dashboard.logout}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

