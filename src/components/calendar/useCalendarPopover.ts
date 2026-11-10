'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'

export interface CalendarPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

const VIEWPORT_PADDING = 8
const ANCHOR_GAP = 8
const MIN_POPUP_WIDTH = 320

/**
 * Shared popover behaviour for the calendar triggers: portal positioning,
 * outside-click closing, Escape handling, Tab containment and focus
 * restoration. Both the Health Data trigger and the reusable date field use
 * the same implementation so keyboard users get one consistent behaviour.
 */
export function useCalendarPopover<T extends HTMLElement>(
  anchorRef: RefObject<T | null>,
  popupRef: RefObject<HTMLDivElement | null>,
) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<CalendarPosition | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const open = useCallback(() => {
    restoreFocusRef.current =
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : anchorRef.current
    setIsOpen(true)
    setPosition(null)
  }, [anchorRef])

  const close = useCallback(
    (restoreFocus = true) => {
      setIsOpen(false)
      setPosition(null)
      if (restoreFocus && typeof window !== 'undefined') {
        const target = restoreFocusRef.current ?? anchorRef.current
        window.requestAnimationFrame(() => target?.focus())
      }
    },
    [anchorRef],
  )

  const toggle = useCallback(() => {
    if (isOpen) {
      close(false)
    } else {
      open()
    }
  }, [isOpen, open, close])

  useEffect(() => {
    if (!isOpen) return
    const anchor = anchorRef.current
    if (!anchor) return

    const updatePosition = () => {
      const popup = popupRef.current
      if (!popup) return

      const trigger = anchor.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const maxHeight = Math.max(0, viewportHeight - VIEWPORT_PADDING * 2)
      const width = Math.min(
        Math.max(trigger.width, MIN_POPUP_WIDTH),
        Math.max(0, viewportWidth - VIEWPORT_PADDING * 2),
      )

      // scrollHeight is the natural content height even when a previous
      // maxHeight capped the popup. Apply the new width first so wrapping is
      // measured at the width that will be used, then add the borders because
      // scrollHeight includes padding but not borders.
      popup.style.width = `${width}px`
      const popupStyle = window.getComputedStyle(popup)
      const borders =
        (Number.parseFloat(popupStyle.borderTopWidth) || 0) +
        (Number.parseFloat(popupStyle.borderBottomWidth) || 0)
      const naturalHeight = popup.scrollHeight + borders
      const height = Math.min(naturalHeight, maxHeight)
      const left = Math.max(
        VIEWPORT_PADDING,
        Math.min(
          trigger.left,
          viewportWidth - VIEWPORT_PADDING - width,
        ),
      )

      const spaceBelow =
        viewportHeight - trigger.bottom - ANCHOR_GAP - VIEWPORT_PADDING
      const spaceAbove = trigger.top - ANCHOR_GAP - VIEWPORT_PADDING
      const fitsBelow = height === 0 || height <= spaceBelow
      const fitsAbove = height > 0 && height <= spaceAbove

      let top =
        fitsBelow || !fitsAbove
          ? trigger.bottom + ANCHOR_GAP
          : trigger.top - ANCHOR_GAP - height
      top = Math.max(
        VIEWPORT_PADDING,
        Math.min(top, viewportHeight - VIEWPORT_PADDING - height),
      )

      setPosition({ top, left, width, maxHeight })
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      close(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    updatePosition()

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen, anchorRef, popupRef, close])

  const handlePopupKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      }

      if (event.key !== 'Tab') return
      const popup = popupRef.current
      if (!popup) return

      const focusable = Array.from(
        popup.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      const active = document.activeElement
      const inside = active instanceof Node && popup.contains(active)
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [close, popupRef],
  )

  return {
    isOpen,
    position,
    open,
    close,
    toggle,
    handlePopupKeyDown,
  }
}
