'use client'

import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  icon: LucideIcon
  /** Clases de degradado Tailwind para el icono (p. ej. 'from-blue-600 to-blue-700'). */
  iconGradient: string
  /** Clase de color Tailwind del valor destacado (p. ej. 'text-blue-600'). */
  accent: string
  title: string
  value: string
  description?: string
}

/**
 * Tarjeta de estadística única para Analytics: una sola estructura de
 * padding, radios, tipografía y tamaños para todas las tarjetas, con el
 * ancho pensado para filas de 3 (escritorio) o 2 (tablet) centradas.
 */
export default function StatCard({ icon: Icon, iconGradient, accent, title, value, description }: StatCardProps) {
  return (
    <div className="relative w-full bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]">
      <div className="flex items-center">
        <div className="flex-shrink-0">
          <div className={`p-2 sm:p-3 bg-gradient-to-br ${iconGradient} rounded-xl sm:rounded-2xl shadow-lg`}>
            <Icon className="h-6 w-6 sm:h-7 sm:w-7 text-white" aria-hidden="true" />
          </div>
        </div>
        <div className="ml-3 sm:ml-4 min-w-0">
          <h3 className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 truncate">{title}</h3>
          <p className={`text-2xl sm:text-3xl font-bold ${accent}`}>{value}</p>
          {description !== undefined && (
            <p className="text-xs sm:text-sm text-slate-600 truncate">{description}</p>
          )}
        </div>
      </div>
    </div>
  )
}
