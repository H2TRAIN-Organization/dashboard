'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, Users, X } from 'lucide-react'
import type { User } from '@/lib/api-types'
import { getDisplayUsername } from '@/lib/user-mapper'
import { useLanguage } from '@/contexts/LanguageContext'

interface UserAutocompleteProps {
  users: readonly User[]
  /** Selected username, or the `all` sentinel. */
  value: string
  onChange: (username: string) => void
  label: string
  allUsersLabel: string
  loading?: boolean
  error?: string | null
  disabled?: boolean
}

interface UserOption {
  key: string
  username: string
  primary: string
  secondary: string | null
}

interface PopupPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
}

export default function UserAutocomplete({
  users,
  value,
  onChange,
  label,
  allUsersLabel,
  loading = false,
  error = null,
  disabled = false,
}: UserAutocompleteProps) {
  const { t } = useLanguage()
  const inputId = useId()
  const listId = `${inputId}-listbox`
  const triggerRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<PopupPosition | null>(null)

  const selectableUsers = useMemo(
    () => users.filter((user) => user.Username.trim().length > 0),
    [users],
  )

  const displayNameFor = useCallback(
    (username: string): string => {
      const match = selectableUsers.find((user) => user.Username === username)
      return match ? getDisplayUsername(match) : username
    },
    [selectableUsers],
  )

  // The input is derived from the committed selection unless the user is
  // typing a draft. This avoids synchronizing state from an effect.
  const selectedLabel = value === 'all' ? '' : displayNameFor(value)
  const query = draft ?? selectedLabel

  const matches = useMemo(() => {
    const needle = normalizeSearchValue(query)
    if (needle.length === 0) return selectableUsers
    return selectableUsers.filter((user) => {
      const primary = normalizeSearchValue(getDisplayUsername(user))
      const secondary = normalizeSearchValue(user.Email ?? '')
      return primary.includes(needle) || secondary.includes(needle)
    })
  }, [query, selectableUsers])

  const options: UserOption[] = useMemo(() => {
    const allOption: UserOption = {
      key: 'all',
      username: 'all',
      primary: allUsersLabel,
      secondary: null,
    }
    return [
      allOption,
      ...matches.map((user) => ({
        key: user.UserID,
        username: user.Username,
        primary: getDisplayUsername(user),
        secondary:
          user.Email && user.Email !== user.Username ? user.Email : null,
      })),
    ]
  }, [allUsersLabel, matches])

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const padding = 8
      const gap = 6
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const width = Math.max(
        240,
        Math.min(rect.width, viewportWidth - padding * 2),
      )
      const left = Math.max(
        padding,
        Math.min(rect.left, viewportWidth - padding - width),
      )
      const spaceBelow = viewportHeight - rect.bottom - gap - padding
      const spaceAbove = rect.top - gap - padding
      const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow
      const maxHeight = Math.max(120, Math.min(320, openAbove ? spaceAbove : spaceBelow))
      const top = openAbove
        ? Math.max(padding, rect.top - gap - maxHeight)
        : rect.bottom + gap

      setPosition({ top, left, width, maxHeight })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      setOpen(false)
      setDraft(null)
      setActiveIndex(-1)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const popup = popupRef.current
    if (!popup) return
    const active = popup.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const select = useCallback(
    (username: string) => {
      onChange(username)
      setDraft(null)
      setOpen(false)
      setActiveIndex(-1)
      inputRef.current?.focus()
    },
    [onChange],
  )

  const clearSelection = useCallback(() => {
    onChange('all')
    setDraft(null)
    setActiveIndex(-1)
    setOpen(false)
  }, [onChange])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => Math.min(current + 1, options.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveIndex(options.length - 1)
      return
    }
    if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault()
        select(options[activeIndex].username)
      } else if (open && matches.length === 1) {
        event.preventDefault()
        select(matches[0].Username)
      }
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
        setActiveIndex(-1)
        setDraft(null)
      }
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      setActiveIndex(-1)
      setDraft(null)
    }
  }

  const showClear = value !== 'all' || (draft !== null && draft.length > 0)
  const activeOptionId =
    open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined

  const popup =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popupRef}
            className="bg-white border-2 border-blue-200 rounded-xl shadow-2xl overflow-hidden"
            style={{
              position: 'fixed',
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              width: position?.width ?? 280,
              maxHeight: position?.maxHeight ?? 320,
              zIndex: 2147483000,
            }}
          >
            {loading ? (
              <div className="px-4 py-3 text-sm text-slate-600" role="status">
                {t.dashboard.loadingUsers}
              </div>
            ) : error ? (
              <div className="px-4 py-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            ) : (
              <ul
                id={listId}
                role="listbox"
                aria-label={t.dashboard.userSuggestions}
                className="max-h-80 overflow-y-auto py-1"
              >
                {options.map((option, index) => {
                  const isActive = index === activeIndex
                  const isSelected =
                    option.username === 'all'
                      ? value === 'all'
                      : option.username === value
                  return (
                    <li
                      key={option.key}
                      id={`${listId}-option-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      data-active={isActive ? 'true' : undefined}
                      className={`flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer ${
                        isActive ? 'bg-blue-50' : 'bg-white'
                      } ${isSelected ? 'font-semibold text-blue-900' : 'text-slate-700'}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(option.username)}
                    >
                      <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                        {option.username === 'all' ? (
                          <Users className="h-4 w-4" />
                        ) : (
                          <span className="text-xs font-bold">
                            {option.primary.charAt(0).toLocaleUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words">{option.primary}</span>
                        {option.secondary ? (
                          <span className="block break-all text-xs text-slate-500">
                            {option.secondary}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <Check aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-blue-600" />
                      ) : null}
                    </li>
                  )
                })}
                {matches.length === 0 && query.trim().length > 0 ? (
                  <li
                    role="presentation"
                    className="px-4 py-3 text-sm text-slate-500"
                  >
                    {t.dashboard.noUserMatches}
                  </li>
                ) : null}
              </ul>
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <div className="relative" ref={triggerRef}>
      <label
        htmlFor={inputId}
        className="block text-xs sm:text-sm font-bold text-blue-900 mb-2 sm:mb-3 flex items-center"
      >
        <Users className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-500" />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={query}
          placeholder={t.dashboard.searchUser}
          onChange={(event) => {
            setDraft(event.target.value)
            setActiveIndex(-1)
            setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            setActiveIndex(-1)
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-white border-2 border-blue-200 rounded-lg sm:rounded-xl pl-9 pr-16 py-2 sm:py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-blue-900 shadow-lg hover:border-blue-300 transition-all duration-300 text-sm sm:text-base disabled:opacity-60"
        />
        {showClear ? (
          <button
            type="button"
            onClick={clearSelection}
            aria-label={t.dashboard.clearUserSelection}
            title={t.dashboard.clearUserSelection}
            className="absolute right-8 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
      </div>
      {popup}
    </div>
  )
}
