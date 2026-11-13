'use client'

import { Loader2 } from 'lucide-react'
import { cn } from 'cn'

/**
 * Estado de carga del dashboard (MT59). Antes cada vista pintaba su propio
 * spinner (tarjeta glass, spinner suelto, texto plano); este componente es el
 * único punto de estilo. La etiqueta llega traducida desde quien lo usa para
 * que el componente no dependa del contexto de idioma.
 */
export function LoadingState({
  label,
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-gray-200/50 bg-white/90 p-8 text-center shadow-xl backdrop-blur-xl sm:rounded-3xl',
        className,
      )}
    >
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
      {label !== undefined && label.length > 0 && (
        <p className="text-sm font-medium text-gray-700">{label}</p>
      )}
    </div>
  )
}
