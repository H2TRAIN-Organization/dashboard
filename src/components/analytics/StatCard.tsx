'use client'

import type { LucideIcon } from 'lucide-react'
import { CHART_PRIMARY_COLOR } from '@/components/analytics/chart-theme'

interface StatCardProps {
  icon: LucideIcon
  /** Clases de degradado Tailwind para el icono (p. ej. 'from-blue-600 to-blue-700'). */
  iconGradient: string
  /** Clase de color Tailwind del valor destacado (p. ej. 'text-blue-600'). */
  accent: string
  title: string
  value: string
  description?: string
  /**
   * Serie decorativa de contexto (últimos días) dibujada como mini-barras.
   * Los valores son recuentos por día en orden cronológico.
   */
  sparkData?: readonly number[]
  /** Color hex de las mini-barras (coherente con el acento de la tarjeta). */
  sparkColor?: string
}

const SPARK_WIDTH = 100
const SPARK_HEIGHT = 24

/**
 * Mini-barras de tendencia: contexto visual del valor grande, decorativo
 * (aria-hidden) porque el dato exacto ya está en la tarjeta.
 */
function StatSparkline({ data, color }: { data: readonly number[]; color: string }) {
  const max = Math.max(...data, 0)
  if (max <= 0) return null

  const barWidth = (SPARK_WIDTH / data.length) * 0.6
  const gap = SPARK_WIDTH / data.length - barWidth

  return (
    <svg
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      width="100%"
      height={SPARK_HEIGHT}
      aria-hidden="true"
      className="mt-3"
    >
      {data.map((value, index) => {
        const height = (value / max) * (SPARK_HEIGHT - 2)
        return (
          <rect
            key={index}
            x={index * (barWidth + gap)}
            y={SPARK_HEIGHT - height}
            width={barWidth}
            height={height}
            rx={2}
            fill={color}
            opacity={0.8}
          />
        )
      })}
    </svg>
  )
}

/**
 * Tarjeta de estadística única para Analytics: una sola estructura de
 * padding, radios, tipografía y tamaños para todas las tarjetas, con el
 * ancho pensado para filas de 3 (escritorio) o 2 (tablet) centradas.
 */
export default function StatCard({ icon: Icon, iconGradient, accent, title, value, description, sparkData, sparkColor = CHART_PRIMARY_COLOR }: StatCardProps) {
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
      {sparkData !== undefined && sparkData.length > 1 && (
        <StatSparkline data={sparkData} color={sparkColor} />
      )}
    </div>
  )
}
