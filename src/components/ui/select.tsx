'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

/**
 * Select del sistema (MT59): envuelve el <select> nativo (accesible y con el
 * comportamiento que los e2e ya conocen) con el estilo compartido del
 * dashboard y un indicador de apertura único. Las dos variantes reproducen
 * los dos looks que había en la app: el acento azul de /data y el neutro del
 * resto de vistas.
 */
const selectVariants = cva(
  'w-full cursor-pointer appearance-none truncate pr-9 font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        accent:
          'rounded-lg border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-3 py-2 text-blue-900 shadow-lg hover:border-blue-300 focus:border-blue-500 sm:rounded-xl sm:px-4 sm:py-3',
        default:
          'rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm hover:border-blue-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    VariantProps<typeof selectVariants> {}

function Select({ className, variant, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select className={cn(selectVariants({ variant, className }))} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
        aria-hidden="true"
      />
    </div>
  )
}

export { Select, selectVariants }
