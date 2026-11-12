'use client'

import type { LucideIcon } from 'lucide-react'

interface ChartCardProps {
  icon: LucideIcon
  /** Clases del degradado del icono, p. ej. "from-blue-500 to-blue-600". */
  iconGradient: string
  title: string
  /** Tamaño del título; por defecto el de las tarjetas de la rejilla. */
  titleClassName?: string
  /** Texto introductorio bajo el título (acepta negritas); su ausencia aumenta el margen del título. */
  description?: React.ReactNode
  children: React.ReactNode
}

/**
 * Tarjeta de gráfico de Advanced Analytics: encapsula el contenedor visual
 * (fondo translúcido, degradado decorativo, sombra y esquinas redondeadas)
 * y la cabecera con icono + título, para que las páginas no repitan el
 * markup. El estilo es idéntico al que las tarjetas tenían inline (T15).
 */
export default function ChartCard({
  icon: Icon,
  iconGradient,
  title,
  titleClassName = 'text-lg',
  description,
  children,
}: ChartCardProps) {
  return (
    <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-3xl p-8 overflow-hidden shadow-xl">
      <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-3xl"></div>

      <div className="relative z-10">
        <h3 className={`${titleClassName} font-bold text-slate-800 ${description ? 'mb-2' : 'mb-6'} flex items-center`}>
          <div className={`p-2 bg-gradient-to-br ${iconGradient} rounded-lg mr-3`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
          {title}
        </h3>
        {description && <p className="text-sm text-slate-600 mb-6">{description}</p>}
        {children}
      </div>
    </div>
  )
}
