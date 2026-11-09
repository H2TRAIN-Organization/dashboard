'use client'

import { createPortal } from 'react-dom'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import type { CalendarPosition } from './useCalendarPopover'

interface CalendarPopupProps {
  id: string
  popupRef: RefObject<HTMLDivElement | null>
  position: CalendarPosition | null
  label: string
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

/**
 * Portal wrapper for calendar dialogs. The transparent full-viewport layer
 * keeps the popup above navigation and table clipping contexts; clicking it
 * closes the calendar through the shared popover hook.
 */
export default function CalendarPopup({
  id,
  popupRef,
  position,
  label,
  onKeyDown,
  children,
}: CalendarPopupProps) {
  if (typeof document === 'undefined') return null

  const style = position
    ? {
        position: 'fixed' as const,
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }
    : {
        position: 'fixed' as const,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(20rem, calc(100vw - 1rem))',
        maxHeight: 'calc(100vh - 1rem)',
      }

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: 9999999 }}>
      <div
        id={id}
        ref={popupRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10"
        style={style}
      >
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
