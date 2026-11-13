'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Filter, Maximize2, X, type LucideIcon } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { Button } from '@/components/ui/button'
import ChartCard from './ChartCard'

/**
 * Expansión de gráficos (MT69): botón de expandir en la esquina, overlay
 * animado con el gráfico a mayor tamaño y controles de filtro cuyo alcance
 * es EXCLUSIVO de ese gráfico: al cerrar el overlay el resto de la página no
 * ha cambiado. Los filtros propios solo pueden estrechar la ventana ya
 * cargada (ver src/lib/chart-scoped-filter.ts).
 */

/** Definición del filtro con alcance de un solo gráfico. */
export interface ChartScopedFilter {
  /** Controles visibles solo en la vista expandida. */
  node: ReactNode
  /** true cuando el filtro propio está aplicando un estrechamiento. */
  active: boolean
  /** Texto corto del chip que anuncia el filtro activo en la tarjeta. */
  summary?: string
  /** Restablece el filtro propio. */
  onClear?: () => void
}

const OVERLAY_BACKDROP_Z = 90
const OVERLAY_PANEL_Z = 91

function useMounted(): boolean {
  // Hidratación sin setState en efecto: snapshot de servidor false, de
  // cliente true (useSyncExternalStore no dispara renders en cascada).
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )
}

const subscribeNoop = () => () => {}

/** Estado de expansión de un gráfico, aislado por instancia. */
export function useChartExpand() {
  const [open, setOpen] = useState(false)
  return {
    open,
    expand: () => setOpen(true),
    collapse: () => setOpen(false),
  }
}

/** Botón de expandir: esquina superior derecha de la cabecera del gráfico. */
export function ChartExpandButton({ onExpand }: { onExpand: () => void }) {
  const { t } = useLanguage()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-haspopup="dialog"
      aria-label={t.chart.expand}
      title={t.chart.expand}
      onClick={onExpand}
    >
      <Maximize2 aria-hidden="true" />
    </Button>
  )
}

/**
 * Overlay a pantalla casi completa con el gráfico ampliado. Se monta en el
 * body (portal) para no heredar transforms del ancestro, anima entrada y
 * salida con un muelle y se cierra con Esc, con el fondo o con el botón.
 */
export function ChartExpandOverlay({
  open,
  onClose,
  title,
  icon,
  iconGradient = 'from-blue-500 to-indigo-600',
  scopedFilter,
  renderChart,
}: {
  open: boolean
  onClose: () => void
  title: string
  icon?: LucideIcon
  iconGradient?: string
  scopedFilter?: ChartScopedFilter
  /** Dibuja el gráfico a tamaño expandido; se mantiene vivo durante la salida. */
  renderChart: () => ReactNode
}) {
  const { t } = useLanguage()
  const mounted = useMounted()
  const closeRef = useRef<HTMLButtonElement>(null)
  const Icon = icon

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="chart-expand-backdrop"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            style={{ zIndex: OVERLAY_BACKDROP_Z }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            key="chart-expand-panel"
            className="pointer-events-none fixed inset-0 flex items-center justify-center p-4 sm:p-8"
            style={{ zIndex: OVERLAY_PANEL_Z }}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className="pointer-events-auto flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-gray-200/50 bg-white/95 shadow-2xl backdrop-blur-xl"
              variants={{
                hidden: { opacity: 0, scale: 0.92, y: 24 },
                visible: { opacity: 1, scale: 1, y: 0 },
              }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            >
              <div className="flex flex-col gap-3 border-b border-gray-200/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-6">
                <div className="flex min-w-0 items-center gap-3">
                  {Icon !== undefined && (
                    <div className={`shrink-0 rounded-lg bg-gradient-to-br ${iconGradient} p-2`}>
                      <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                    </div>
                  )}
                  <h3 className="truncate text-lg font-bold text-slate-800">{title}</h3>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {scopedFilter?.node}
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={onClose}
                    aria-label={t.chart.close}
                    title={t.chart.close}
                    className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">{renderChart()}</div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/**
 * Tarjeta de gráfico expandible con el mismo lenguaje visual que ChartCard:
 * añade el botón de expandir, el chip de filtro propio activo y el overlay
 * con controles de filtro exclusivos de este gráfico.
 */
export function ExpandableChartCard({
  icon,
  iconGradient,
  title,
  titleClassName,
  description,
  scopedFilter,
  children,
}: {
  icon: LucideIcon
  iconGradient: string
  title: string
  titleClassName?: string
  description?: ReactNode
  scopedFilter?: ChartScopedFilter
  children: (state: { expanded: boolean }) => ReactNode
}) {
  const { open, expand, collapse } = useChartExpand()
  const { t } = useLanguage()

  return (
    <>
      <ChartCard
        icon={icon}
        iconGradient={iconGradient}
        title={title}
        titleClassName={titleClassName}
        description={description}
        actions={
          <>
            {scopedFilter?.active && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                <Filter className="h-3 w-3" aria-hidden="true" />
                {scopedFilter.summary ?? t.chart.ownFilterActive}
                {scopedFilter.onClear && (
                  <button
                    type="button"
                    onClick={scopedFilter.onClear}
                    aria-label={t.chart.clearOwnFilter}
                    title={t.chart.clearOwnFilter}
                    className="rounded-full p-0.5 transition-colors hover:bg-blue-100"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </span>
            )}
            <ChartExpandButton onExpand={expand} />
          </>
        }
      >
        {children({ expanded: false })}
      </ChartCard>
      <ChartExpandOverlay
        open={open}
        onClose={collapse}
        title={title}
        icon={icon}
        iconGradient={iconGradient}
        scopedFilter={scopedFilter}
        renderChart={() => children({ expanded: true })}
      />
    </>
  )
}
