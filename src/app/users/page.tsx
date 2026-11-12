'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { User, UserRole } from '@/lib/api-types'
import { errorMessage, usersApi } from '@/lib/api-client'
import { getDisplayUsername } from '@/lib/user-mapper'
import {
  DEFAULT_USERS_PAGE_SIZE,
  USERS_PAGE_SIZES,
  clampUsersPage,
  pageAfterDeletion,
  usersRange,
  usersTotalPages,
  isUsersPageSize,
  type UsersPageSize,
} from '@/lib/dashboard-data'
import { Edit, Trash2, Search, Save, X, RefreshCw, User as UserIcon, Key, Shield, CheckCircle, AlertCircle, Users, Plus, Lock, ChevronLeft, ChevronRight } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import Navigation from '@/components/Navigation'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'

export default function UsersPage() {
  const { t } = useLanguage()
  const { session } = useSession()
  const canWrite = session?.user.role === 'admin'
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<UsersPageSize>(DEFAULT_USERS_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editForm, setEditForm] = useState({
    Username: '',
    GDPRConsent: false,
    role: 'user'
  })
  const [saving, setSaving] = useState(false)
  const [clearingUUID, setClearingUUID] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<{ password: string; role: UserRole; username: string }>({
    password: '',
    role: 'user',
    username: '',
  })
  const [createLoading, setCreateLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const requestRef = useRef(0)
  const hasLoadedRef = useRef(false)
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const topSpacerRef = useRef<HTMLDivElement | null>(null)
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false)

  const totalPageCount = usersTotalPages(total, pageSize)
  const currentPage = clampUsersPage(page, total, pageSize)
  const range = usersRange(total, currentPage, pageSize)

  const loadUsers = useCallback(async () => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    if (hasLoadedRef.current) setRefreshing(true)
    else setLoading(true)
    try {
      const result = await usersApi.list({
        search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
        page,
        pageSize,
      })
      if (requestId !== requestRef.current) return
      setUsers(result.users)
      setTotal(result.total)
      hasLoadedRef.current = true
      // A filter or a deletion can leave the requested page out of range.
      const nextPage = clampUsersPage(page, result.total, pageSize)
      if (nextPage !== page) setPage(nextPage)
    } catch (error) {
      if (requestId !== requestRef.current) return
      if (error instanceof Error && error.name === 'AbortError') return
      console.error('Error fetching users:', error)
      setMessage({ type: 'error', text: errorMessage(error) })
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [debouncedSearch, page, pageSize])

  // Filters reset pagination after a short debounce (DR18).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    if (!session) return
    let active = true
    const load = async () => {
      // Yield once so the effect body does not synchronously set state.
      await Promise.resolve()
      if (!active) return
      await loadUsers()
    }
    void load()
    return () => {
      active = false
    }
  }, [session, loadUsers])

  const syncHorizontalScrollbar = useCallback(() => {
    const container = tableScrollRef.current
    if (!container) return
    const overflow = container.scrollWidth > container.clientWidth + 1
    setHasHorizontalOverflow(overflow)
    if (topSpacerRef.current) {
      topSpacerRef.current.style.width = `${container.scrollWidth}px`
    }
  }, [])

  useEffect(() => {
    if (loading) return
    syncHorizontalScrollbar()
    const handleResize = () => syncHorizontalScrollbar()
    window.addEventListener('resize', handleResize)
    let observer: ResizeObserver | null = null
    const container = tableScrollRef.current
    if (typeof ResizeObserver !== 'undefined' && container) {
      observer = new ResizeObserver(handleResize)
      observer.observe(container)
      if (container.firstElementChild instanceof HTMLElement) {
        observer.observe(container.firstElementChild)
      }
    }
    return () => {
      window.removeEventListener('resize', handleResize)
      observer?.disconnect()
    }
  }, [loading, syncHorizontalScrollbar])

  const deleteUser = async (user: User) => {
    if (!confirm(t.users.confirmDelete)) {
      return
    }
    try {
      await usersApi.remove(user.UserID)
      setMessage({ type: 'success', text: t.dashboard.userDeleted })
      setUsers((current) => current.filter((entry) => entry.UserID !== user.UserID))
      setTotal((current) => Math.max(0, current - 1))
      const nextPage = pageAfterDeletion(page, total, pageSize)
      if (nextPage !== page) setPage(nextPage)
      else await loadUsers()
    } catch (error) {
      console.error('Error deleting user:', error)
      setMessage({ type: 'error', text: errorMessage(error) })
    }
  }

  const startEditing = (user: User) => {
    setEditingUser(user)
      setEditForm({
        Username: user.Username,
        GDPRConsent: user.GDPRConsent,
        role: user.role || 'user'
      })
  }

  const cancelEditing = () => {
    setEditingUser(null)
    setEditForm({
      Username: '',
      GDPRConsent: false,
      role: 'user'
    })
  }

  const replaceUser = (updated: User) => {
    setUsers(current => current.map(entry => entry.UserID === updated.UserID ? updated : entry))
  }

  const saveUser = async () => {
    if (!editingUser) return

    try {
      setSaving(true)
      const updated = await usersApi.update(editingUser.UserID, {
        username: editForm.Username.trim(),
        gdprConsent: editForm.GDPRConsent,
      })

      replaceUser(updated)
      setEditingUser(null)
      setEditForm({
        Username: '',
        GDPRConsent: false,
        role: 'user'
      })
      setMessage({ type: 'success', text: t.dashboard.userUpdated })
    } catch (error) {
      console.error('Error updating user:', error)
      setMessage({ type: 'error', text: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  const clearUUID = async (userId: string) => {
    if (!confirm(t.dashboard.confirmClearUUID)) {
      return
    }

    try {
      setClearingUUID(true)
      const updated = await usersApi.clearUuid(userId)
      replaceUser(updated)
      setMessage({ type: 'success', text: t.dashboard.uuidCleared })
    } catch (error) {
      console.error('Error clearing UUID:', error)
      setMessage({ type: 'error', text: errorMessage(error) })
    } finally {
      setClearingUUID(false)
    }
  }

  const updateUserRole = async (userId: string, newRole: string) => {
    if (newRole !== 'admin' && newRole !== 'doctor' && newRole !== 'user') return
    try {
      const updated = await usersApi.update(userId, { role: newRole })
      replaceUser(updated)
      setMessage({
        type: 'success',
        text: t.dashboard.roleUpdated
      })
    } catch (error) {
      console.error('Error updating user role:', error)
      setMessage({
        type: 'error',
        text: errorMessage(error)
      })
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setMessage({ type: 'success', text: t.users.uuidCopied })
    }).catch(() => {
      setMessage({ type: 'error', text: t.users.uuidCopyError })
    })
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!createForm.username || !createForm.password) {
      setMessage({ type: 'error', text: t.auth.invalidCredentials })
      return
    }

    try {
      setCreateLoading(true)
      setMessage(null)

      await usersApi.create({
        username: createForm.username.trim(),
        password: createForm.password,
        role: createForm.role,
      })

      setMessage({ type: 'success', text: t.dashboard.userCreated })
      setCreateForm({ password: '', username: '', role: 'user' })
      setShowCreateForm(false)
      await loadUsers()
    } catch (error) {
      console.error('Error:', error)
      setMessage({
        type: 'error',
        text: t.users.createError.replace('{error}', () => errorMessage(error)),
      })
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden">
        {/* Elementos decorativos de fondo */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-1000"></div>
          <div className="absolute top-40 left-1/2 w-80 h-80 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-500"></div>
        </div>
        
        <Navigation title={t.dashboard.userManagement} showBackButton={true} />
        

        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 lg:py-8 xl:py-12 relative z-10">
          {/* Header con estadísticas (MT36): compacto y denso */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 mb-4 sm:mb-6 overflow-hidden shadow-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="p-2.5 sm:p-3 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl shadow-lg">
                  <Users className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">
                    {t.dashboard.userManagement}
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600 font-light truncate">{t.dashboard.userManagementDescription}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-gray-200/50 px-3 py-2 rounded-xl shadow-sm">
                  <span className="h-2.5 w-2.5 bg-green-500 rounded-full animate-pulse" aria-hidden="true"></span>
                  <span className="text-sm text-gray-800 font-semibold">
                    {t.users.total}: {total}
                  </span>
                </div>
                {canWrite && (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 text-white px-4 py-2 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="font-semibold text-sm">{t.dashboard.createUser}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Barra de búsqueda */}
            <div className="relative z-10 mt-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder={t.dashboard.searchUsers}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label={t.dashboard.searchUsers}
                  className="w-full pl-10 sm:pl-12 pr-10 sm:pr-12 py-2.5 sm:py-3 bg-white/50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 hover:bg-white/70 text-sm"
                />
                {searchTerm.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    aria-label={t.common.clear}
                    title={t.common.clear}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-500 hover:bg-white hover:text-gray-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Mensaje de estado (MT36): paleta clara, consistente con el dashboard */}
          {message && (
            <div className={`mb-4 rounded-xl border px-4 py-3 ${
              message.type === 'success' 
                ? 'bg-green-50 text-green-800 border-green-200' 
                : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              <div className="flex items-center space-x-2">
                {message.type === 'success' ? (
                  <CheckCircle className="h-5 w-5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                )}
                <span className="text-sm font-medium">{message.text}</span>
              </div>
            </div>
          )}

          {/* Tabla de usuarios (MT36) */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 overflow-hidden shadow-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>

            <div className="relative z-10">
              {loading ? (
                <div className="flex items-center justify-center py-10 sm:py-14">
                  <div className="flex items-center space-x-3 bg-white/80 backdrop-blur-sm border border-gray-200/50 px-5 sm:px-7 py-3 sm:py-4 rounded-2xl shadow-lg">
                    <div className="animate-spin rounded-full h-6 w-6 sm:h-7 sm:w-7 border-b-2 border-blue-600"></div>
                    <span className="text-gray-800 font-semibold text-sm sm:text-base">{t.dashboard.loadingUsers}</span>
                  </div>
                </div>
              ) : (
                <>
                  {/* Vista de tarjetas para móvil (MT36): densa y con la
                      misma información que la tabla. */}
                  <div className="block lg:hidden space-y-3">
                    {users.map((user) => (
                      <div key={user.UserID} className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300">
                        {/* Header de la tarjeta */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow flex-shrink-0">
                              <span className="text-base font-bold text-white">
                                {getDisplayUsername(user).charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-bold text-gray-900 break-words leading-snug">{getDisplayUsername(user)}</h3>
                              <p className="text-xs text-gray-600">ID: {user.UserID}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            {/* Rol */}
                            {canWrite ? (
                              <select
                                value={user.role || 'user'}
                                onChange={(e) => updateUserRole(user.UserID, e.target.value)}
                                aria-label={t.users.roleLabel}
                                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-900 focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="admin">{t.dashboard.admin}</option>
                                <option value="doctor">{t.dashboard.doctor}</option>
                                <option value="user">{t.dashboard.user}</option>
                              </select>
                            ) : (
                              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700 capitalize">
                                {user.role}
                              </span>
                            )}
                            {/* Estado + GDPR como píldoras compactas */}
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                                <CheckCircle className="h-3 w-3" />
                                {t.users.activeStatus}
                              </span>
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${user.GDPRConsent ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {user.GDPRConsent ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                                {t.users.gdpr}: {user.GDPRConsent ? t.users.yes : t.users.no}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* UUID */}
                        <div className="mt-3 flex items-center gap-2">
                          <div className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-[11px] text-gray-800" title={user.UUID ?? t.users.noUUIDAssigned}>
                            {user.UUID ?? t.users.noUUIDAssigned}
                          </div>
                          {user.UUID && (
                            <button
                              onClick={() => copyToClipboard(user.UUID!)}
                              className="rounded-lg border border-blue-200 bg-white p-1.5 text-blue-600 hover:bg-blue-50 transition-colors flex-shrink-0"
                              title={t.users.copyUUID}
                              aria-label={t.users.copyUUID}
                            >
                              <Key className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Botones de acción */}
                        {canWrite && (
                          <div className="mt-3 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
                            <button
                              onClick={() => startEditing(user)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
                              title={t.dashboard.edit}
                            >
                              <Edit className="h-3.5 w-3.5" />
                              {t.dashboard.edit}
                            </button>
                            <button
                              onClick={() => clearUUID(user.UserID)}
                              disabled={clearingUUID}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                              title={t.users.clearUUID}
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${clearingUUID ? 'animate-spin' : ''}`} />
                              {t.common.clear}
                            </button>
                            <button
                              onClick={() => deleteUser(user)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                              title={t.dashboard.delete}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t.dashboard.delete}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Vista de tabla para desktop */}
                  <div className="hidden lg:block">
                    {/* Barra horizontal superior sincronizada con la tabla.
                        Solo se muestra cuando la tabla desborda (DR19). */}
                    <div
                      ref={topScrollRef}
                      aria-hidden="true"
                      className={`mb-2 overflow-x-auto ${hasHorizontalOverflow ? 'block' : 'hidden'}`}
                      onScroll={(event) => {
                        if (tableScrollRef.current) {
                          tableScrollRef.current.scrollLeft = event.currentTarget.scrollLeft
                        }
                      }}
                    >
                      <div ref={topSpacerRef} className="h-1" />
                    </div>
                    <div
                      ref={tableScrollRef}
                      className="overflow-x-auto"
                      onScroll={(event) => {
                        if (topScrollRef.current) {
                          topScrollRef.current.scrollLeft = event.currentTarget.scrollLeft
                        }
                      }}
                    >
                      <table className="w-full min-w-[960px] table-fixed">
                        <colgroup>
                          <col className="w-[24%]" />
                          <col className="w-[32%]" />
                          <col className="w-[14%]" />
                          <col className="w-[16%]" />
                          <col className="w-[14%]" />
                        </colgroup>
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                            {t.dashboard.username}
                          </th>
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                            UUID
                          </th>
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                            {t.users.status}
                          </th>
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                            {t.users.role}
                          </th>
                          <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-800 uppercase tracking-wider">
                            {t.dashboard.actions}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <tr key={user.UserID} className="border-b border-gray-100 hover:bg-blue-50/40 transition-colors">
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="h-9 w-9 flex-shrink-0 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow">
                                  <span className="text-sm font-bold text-white">
                                    {getDisplayUsername(user).charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-bold text-gray-900 break-words leading-snug">
                                    {getDisplayUsername(user)}
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    ID: {user.UserID}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <div className="flex items-start gap-1.5">
                                <div className="min-w-0 flex-1 break-all rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-800">
                                  {user.UUID ?? t.users.noUUIDAssigned}
                                </div>
                                {user.UUID && (
                                  <button
                                    onClick={() => copyToClipboard(user.UUID!)}
                                    className="flex-shrink-0 rounded-lg border border-blue-200 bg-white p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                                    title={t.users.copyUUID}
                                    aria-label={t.users.copyUUID}
                                  >
                                    <Key className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-col items-start gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                                  <CheckCircle className="h-3 w-3" />
                                  {t.users.activeStatus}
                                </span>
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${user.GDPRConsent ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                  {user.GDPRConsent ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                                  {t.users.gdpr}: {user.GDPRConsent ? t.users.yes : t.users.no}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              {canWrite ? (
                                <select
                                  value={user.role || 'user'}
                                  onChange={(e) => updateUserRole(user.UserID, e.target.value)}
                                  aria-label={t.users.roleLabel}
                                  className="w-full max-w-[10rem] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-900 focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="admin">{t.dashboard.admin}</option>
                                  <option value="doctor">{t.dashboard.doctor}</option>
                                  <option value="user">{t.dashboard.user}</option>
                                </select>
                              ) : (
                                <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700 capitalize">
                                  {user.role}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {canWrite && (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => startEditing(user)}
                                    className="rounded-lg border border-blue-200 bg-white p-2 text-blue-600 hover:bg-blue-50 transition-colors"
                                    title={t.dashboard.edit}
                                    aria-label={t.dashboard.edit}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => clearUUID(user.UserID)}
                                    disabled={clearingUUID}
                                    className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                                    title={t.users.clearUUID}
                                    aria-label={t.users.clearUUID}
                                  >
                                    <RefreshCw className={`h-4 w-4 ${clearingUUID ? 'animate-spin' : ''}`} />
                                  </button>
                                  <button
                                    onClick={() => deleteUser(user)}
                                    className="rounded-lg border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50 transition-colors"
                                    title={t.dashboard.delete}
                                    aria-label={t.dashboard.delete}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>

                  {/* Paginación compartida por la tabla y las tarjetas móviles
                      (DR18): misma página, mismo total filtrado. */}
                  {total > 0 && (
                    <div className="mt-6 flex flex-col gap-4 border-t border-gray-200 pt-4 lg:flex-row lg:items-center lg:justify-between">
                      <p className="text-sm text-gray-700" aria-live="polite">
                        {range.from}-{range.to} / {total}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <label htmlFor="users-page-size" className="text-sm text-gray-700">
                          {t.dashboard.rowsPerPage}
                        </label>
                        <select
                          id="users-page-size"
                          value={pageSize}
                          onChange={(event) => {
                            const next = Number(event.target.value)
                            if (isUsersPageSize(next)) {
                              setPageSize(next)
                              setPage(1)
                            }
                          }}
                          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
                        >
                          {USERS_PAGE_SIZES.map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage <= 1 || refreshing}
                          aria-label={t.common.previous}
                          title={t.common.previous}
                          className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="min-w-[64px] text-center text-sm font-semibold text-gray-800">
                          {currentPage} / {totalPageCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPage(Math.min(totalPageCount, currentPage + 1))}
                          disabled={currentPage >= totalPageCount || refreshing}
                          aria-label={t.common.next}
                          title={t.common.next}
                          className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {!loading && users.length === 0 && total === 0 && (message === null || message.type === 'success') && (
              <div className="relative z-10 text-center py-12">
                <div className="p-6 bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl inline-block shadow-lg">
                  <UserIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 text-base font-semibold">{t.users.noResults}</p>
                </div>
              </div>
            )}
          </div>

          {/* Modal de edición */}
          {editingUser && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="relative bg-white/95 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900">{t.users.editUser}</h3>
                  <button
                    onClick={cancelEditing}
                    className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                    aria-label={t.users.cancel}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3 sm:mb-4">
                      {t.users.usernameLabel}
                    </label>
                    <input
                      type="text"
                      value={editForm.Username}
                      onChange={(e) => setEditForm({ ...editForm, Username: e.target.value })}
                      className="w-full bg-white/50 border border-gray-200 rounded-xl px-3 sm:px-4 py-3 sm:py-4 text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 hover:bg-white/70 text-sm sm:text-base"
                    />
                  </div>

                  <div className="flex items-center space-x-3 sm:space-x-4">
                    <input
                      type="checkbox"
                      id="gdpr-consent"
                      checked={editForm.GDPRConsent}
                      onChange={(e) => setEditForm({ ...editForm, GDPRConsent: e.target.checked })}
                      className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 focus:ring-blue-500 border-gray-300 rounded bg-white"
                    />
                    <label htmlFor="gdpr-consent" className="block text-sm sm:text-base font-semibold text-gray-700">
                      {t.users.gdprConsent}
                    </label>
                  </div>

                  <div className="bg-white/50 border border-gray-200 p-4 sm:p-6 rounded-xl">
                    <div className="flex items-center mb-3 sm:mb-4">
                      <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 mr-2 sm:mr-3" />
                      <span className="text-sm sm:text-base font-semibold text-gray-700">{t.users.currentUUID}</span>
                    </div>
                    <div className="text-xs sm:text-sm text-gray-600 font-mono break-all bg-gray-50 border border-gray-200 rounded-lg px-3 sm:px-4 py-2 sm:py-3">
                      {editingUser.UUID || t.users.noUUIDAssigned}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 mt-6">
                  <button
                    onClick={cancelEditing}
                    className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-white/50 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    {t.users.cancel}
                  </button>
                  <button
                    onClick={saveUser}
                    disabled={saving || !editForm.Username.trim()}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 rounded-xl hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors shadow-lg"
                  >
                    {saving ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        {t.users.saving}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        {t.users.save}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal de creación de usuario */}
          {showCreateForm && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="relative bg-white/95 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900">{t.users.createNewUser}</h3>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                    aria-label={t.users.cancel}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleCreateUser} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3 sm:mb-4">
                      <UserIcon className="h-4 w-4 sm:h-5 sm:w-5 inline mr-2" />
                      {t.users.usernameLabel} *
                    </label>
                    <input
                      type="text"
                      value={createForm.username}
                      onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                      className="w-full bg-white/50 border border-gray-200 rounded-xl px-3 sm:px-4 py-3 sm:py-4 text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 hover:bg-white/70 text-sm sm:text-base"
                      placeholder={t.users.usernameLabel}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3 sm:mb-4">
                      <Lock className="h-4 w-4 sm:h-5 sm:w-5 inline mr-2" />
                      {t.users.passwordLabel} *
                    </label>
                    <input
                      type="password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      className="w-full bg-white/50 border border-gray-200 rounded-xl px-3 sm:px-4 py-3 sm:py-4 text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 hover:bg-white/70 text-sm sm:text-base"
                      placeholder={t.users.passwordLabel}
                      minLength={6}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3 sm:mb-4">
                      <Shield className="h-4 w-4 sm:h-5 sm:w-5 inline mr-2" />
                      {t.users.roleLabel} *
                    </label>
                    <select
                      value={createForm.role}
                      onChange={(e) => {
                        const role = e.target.value
                        if (role === 'admin' || role === 'doctor' || role === 'user') {
                          setCreateForm({ ...createForm, role })
                        }
                      }}
                      className="w-full bg-white/50 border border-gray-200 rounded-xl px-3 sm:px-4 py-3 sm:py-4 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 hover:bg-white/70 text-sm sm:text-base"
                    >
                      <option value="user">{t.dashboard.user}</option>
                      <option value="doctor">{t.dashboard.doctor}</option>
                      <option value="admin">{t.dashboard.admin}</option>
                    </select>
                  </div>

                  <div className="bg-white/50 border border-gray-200 p-4 sm:p-6 rounded-xl">
                    <div className="flex items-center mb-3 sm:mb-4">
                      <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 mr-2 sm:mr-3" />
                      <span className="text-sm sm:text-base font-semibold text-gray-700">{t.users.information}</span>
                    </div>
                    <p className="text-xs sm:text-sm text-gray-600">
                      {t.users.userWillBeCreated}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-white/50 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      {t.users.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={createLoading || !createForm.username || !createForm.password}
                      className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 rounded-xl hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors shadow-lg"
                    >
                      {createLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          {t.users.creating}
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-2" />
                          {t.users.create}
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
} 