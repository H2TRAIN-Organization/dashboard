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
          {/* Header con estadísticas */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-10 mb-6 sm:mb-12 overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 sm:mb-8 space-y-4 lg:space-y-0">
              <div className="flex flex-col sm:flex-row sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
                <div className="flex items-center space-x-4 sm:space-x-6">
                  <div className="p-3 sm:p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl sm:rounded-2xl shadow-lg">
                    <Users className="h-8 w-8 sm:h-12 sm:w-12 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-gray-900">
                      {t.dashboard.userManagement}
                    </h2>
                    <p className="text-gray-600 text-sm sm:text-base lg:text-xl font-light">{t.dashboard.userManagementDescription}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="flex items-center space-x-3 bg-white/80 backdrop-blur-sm border border-gray-200/50 px-4 sm:px-6 py-2 sm:py-3 rounded-xl shadow-lg">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm sm:text-base text-gray-800 font-semibold">
                    {t.users.total}: {total}
                  </span>
                </div>
                {canWrite && (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="flex items-center space-x-2 sm:space-x-3 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 shadow-lg hover:shadow-xl"
                  >
                    <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span className="font-semibold text-sm sm:text-lg">{t.dashboard.createUser}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Barra de búsqueda */}
            <div className="relative z-10">
              <div className="relative max-w-md">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 sm:h-6 sm:w-6 text-gray-400" />
                <input
                  type="text"
                  placeholder={t.dashboard.searchUsers}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label={t.dashboard.searchUsers}
                  className="w-full pl-12 sm:pl-14 pr-12 sm:pr-14 py-3 sm:py-4 bg-white/50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 hover:bg-white/70 text-sm sm:text-base"
                />
                {searchTerm.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    aria-label={t.common.clear}
                    title={t.common.clear}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-500 hover:bg-white hover:text-gray-800"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Mensaje de estado */}
          {message && (
            <div className={`mb-6 p-4 rounded-xl border ${
              message.type === 'success' 
                ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                : 'bg-red-500/20 text-red-300 border-red-500/30'
            }`}>
              <div className="flex items-center space-x-2">
                {message.type === 'success' ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <AlertCircle className="h-5 w-5" />
                )}
                <span className="font-medium">{message.text}</span>
              </div>
            </div>
          )}

          {/* Tabla de usuarios */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-10 overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>

            <div className="relative z-10">
              {loading ? (
                <div className="flex items-center justify-center py-12 sm:py-20">
                  <div className="flex items-center space-x-4 bg-white/80 backdrop-blur-sm border border-gray-200/50 px-6 sm:px-10 py-4 sm:py-6 rounded-2xl shadow-lg">
                    <div className="animate-spin rounded-full h-8 w-8 sm:h-10 sm:w-10 border-b-2 border-blue-600"></div>
                    <span className="text-gray-800 font-semibold text-base sm:text-lg">{t.dashboard.loadingUsers}</span>
                  </div>
                </div>
              ) : (
                <>
                  {/* Vista de tarjetas para móvil */}
                  <div className="block lg:hidden space-y-4">
                    {users.map((user) => (
                      <div key={user.UserID} className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl p-5 shadow-lg hover:shadow-xl transition-all duration-300">
                        {/* Header de la tarjeta */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 space-y-3 sm:space-y-0">
                          <div className="flex items-center space-x-4">
                            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-lg flex-shrink-0">
                              <span className="text-xl font-bold text-white">
                                {getDisplayUsername(user).charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-lg font-bold text-gray-900 break-words leading-snug">{getDisplayUsername(user)}</h3>
                              <p className="text-sm text-gray-600">ID: {user.UserID}</p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 bg-green-50 px-3 py-2 rounded-lg">
                            <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                            <span className="text-sm font-semibold text-green-700">{t.users.activeStatus}</span>
                          </div>
                        </div>

                        {/* UUID */}
                        <div className="mb-5">
                          <label className="block text-sm font-semibold text-gray-700 mb-3">UUID</label>
                          <div className="flex items-start space-x-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-800 font-mono bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 break-all leading-relaxed">
                                {user.UUID ?? t.users.noUUIDAssigned}
                              </div>
                            </div>
                            {user.UUID && (
                              <button
                                onClick={() => copyToClipboard(user.UUID!)}
                                className="p-3 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg hover:from-blue-500 hover:to-blue-600 transition-all duration-300 transform hover:scale-105 flex-shrink-0 shadow-lg"
                                title={t.users.copyUUID}
                              >
                                <Key className="h-4 w-4 text-white" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* GDPR y Rol */}
                        <div className="flex items-center justify-between mb-5">
                          <div className="flex items-center space-x-2">
                            {user.GDPRConsent ? (
                              <div className="flex items-center space-x-2 bg-green-50 px-3 py-2 rounded-lg">
                                <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                                <span className="text-sm font-semibold text-green-700">{t.users.gdpr}: {t.users.yes}</span>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2 bg-red-50 px-3 py-2 rounded-lg">
                                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                                <span className="text-sm font-semibold text-red-700">{t.users.gdpr}: {t.users.no}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <label className="text-sm font-semibold text-gray-700">{t.users.role}:</label>
                            {canWrite ? (
                              <select
                                value={user.role || 'user'}
                                onChange={(e) => updateUserRole(user.UserID, e.target.value)}
                                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300"
                              >
                                <option value="admin">{t.dashboard.admin}</option>
                                <option value="doctor">{t.dashboard.doctor}</option>
                                <option value="user">{t.dashboard.user}</option>
                              </select>
                            ) : (
                              <span className="px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 capitalize">
                                {user.role}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Botones de acción */}
                        {canWrite && (
                          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 sm:gap-3 pt-2 border-t border-gray-200">
                            <button
                              onClick={() => startEditing(user)}
                              className="flex items-center justify-center px-4 py-2 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg hover:from-blue-500 hover:to-cyan-500 transition-all duration-300 transform hover:scale-105 shadow-lg"
                              title={t.dashboard.edit}
                            >
                              <Edit className="h-4 w-4 text-white" />
                              <span className="text-sm font-medium text-white hidden sm:block ml-2">{t.dashboard.edit}</span>
                            </button>
                            <button
                              onClick={() => clearUUID(user.UserID)}
                              disabled={clearingUUID}
                              className="flex items-center justify-center px-4 py-2 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg hover:from-blue-500 hover:to-blue-600 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:transform-none shadow-lg"
                              title={t.users.clearUUID}
                            >
                              <RefreshCw className={`h-4 w-4 text-white ${clearingUUID ? 'animate-spin' : ''}`} />
                              <span className="text-sm font-medium text-white hidden sm:block ml-2">{t.common.clear}</span>
                            </button>
                            <button
                              onClick={() => deleteUser(user)}
                              className="flex items-center justify-center px-4 py-2 bg-gradient-to-br from-red-600 to-rose-600 rounded-lg hover:from-red-500 hover:to-rose-500 transition-all duration-300 transform hover:scale-105 shadow-lg"
                              title={t.dashboard.delete}
                            >
                              <Trash2 className="h-4 w-4 text-white" />
                              <span className="text-sm font-medium text-white hidden sm:block ml-2">{t.dashboard.delete}</span>
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
                      <table className="w-full min-w-[1040px] table-fixed">
                        <colgroup>
                          <col className="w-[26%]" />
                          <col className="w-[38%]" />
                          <col className="w-[12%]" />
                          <col className="w-[10%]" />
                          <col className="w-[14%]" />
                        </colgroup>
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 text-left text-xs sm:text-sm font-bold text-gray-800 uppercase tracking-wider">
                            {t.dashboard.username}
                          </th>
                          <th className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 text-left text-xs sm:text-sm font-bold text-gray-800 uppercase tracking-wider">
                            UUID
                          </th>
                          <th className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 text-left text-xs sm:text-sm font-bold text-gray-800 uppercase tracking-wider">
                            {t.users.status}
                          </th>
                          <th className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 text-left text-xs sm:text-sm font-bold text-gray-800 uppercase tracking-wider">
                            {t.users.gdpr}
                          </th>
                          <th className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 text-right text-xs sm:text-sm font-bold text-gray-800 uppercase tracking-wider">
                            {t.dashboard.actions}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <tr key={user.UserID} className="border-b border-gray-100 hover:bg-gray-50/50 transition-all duration-300">
                            <td className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 xl:py-8">
                              <div className="flex items-center space-x-2 sm:space-x-3 lg:space-x-4">
                                <div className="flex-shrink-0">
                                  <div className="h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 xl:h-14 xl:w-14 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-lg">
                                    <span className="text-xs sm:text-sm lg:text-base xl:text-xl font-bold text-white">
                                      {getDisplayUsername(user).charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs sm:text-sm lg:text-base xl:text-xl font-bold text-gray-900 break-words leading-snug">
                                    {getDisplayUsername(user)}
                                  </div>
                                  <div className="text-xs sm:text-sm text-gray-600">
                                    ID: {user.UserID}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 xl:py-8 align-top">
                              <div className="flex items-start space-x-2 sm:space-x-3">
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs sm:text-sm text-gray-800 font-mono bg-gray-50 border border-gray-200 rounded-lg px-2 sm:px-3 lg:px-4 py-2 sm:py-3 break-all">
                                    {user.UUID ?? t.users.noUUIDAssigned}
                                  </div>
                                </div>
                                {user.UUID && (
                                  <button
                                    onClick={() => copyToClipboard(user.UUID!)}
                                    className="p-1.5 sm:p-2 lg:p-3 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg hover:from-blue-500 hover:to-blue-600 transition-all duration-300 transform hover:scale-105 flex-shrink-0 shadow-lg"
                                    title={t.users.copyUUID}
                                  >
                                    <Key className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 xl:py-8">
                              <div className="flex items-center space-x-2 sm:space-x-3">
                                <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-green-500" />
                                <span className="text-xs sm:text-sm lg:text-base font-semibold text-gray-900">{t.users.activeStatus}</span>
                              </div>
                            </td>
                            <td className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 xl:py-8">
                              <div className="flex items-center space-x-2 sm:space-x-3">
                                {user.GDPRConsent ? (
                                  <>
                                    <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-green-500" />
                                    <span className="text-xs sm:text-sm lg:text-base font-semibold text-green-700">{t.users.yes}</span>
                                  </>
                                ) : (
                                  <>
                                    <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-red-500" />
                                    <span className="text-xs sm:text-sm lg:text-base font-semibold text-red-700">{t.users.no}</span>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 lg:py-6 xl:py-8 text-right">
                              <div className="flex flex-col items-end gap-2">
                                {/* Selector de rol */}
                                {canWrite ? (
                                  <select
                                    value={user.role || 'user'}
                                    onChange={(e) => updateUserRole(user.UserID, e.target.value)}
                                    aria-label={t.users.roleLabel}
                                    className="px-2 sm:px-3 py-1 sm:py-2 bg-white border border-gray-300 rounded-lg text-xs sm:text-sm font-medium text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 w-full max-w-[9rem]"
                                  >
                                    <option value="admin">{t.dashboard.admin}</option>
                                    <option value="doctor">{t.dashboard.doctor}</option>
                                    <option value="user">{t.dashboard.user}</option>
                                  </select>
                                ) : (
                                  <span className="px-2 sm:px-3 py-1 sm:py-2 bg-gray-100 border border-gray-200 rounded-lg text-xs sm:text-sm font-medium text-gray-700 capitalize">
                                    {user.role}
                                  </span>
                                )}
                                
                                {/* Botones de acción */}
                                {canWrite && (
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <button
                                      onClick={() => startEditing(user)}
                                      className="p-2 sm:p-3 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg hover:from-blue-500 hover:to-cyan-500 transition-all duration-300 transform hover:scale-105 shadow-lg"
                                      title={t.dashboard.edit}
                                    >
                                      <Edit className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white" />
                                    </button>
                                    <button
                                      onClick={() => clearUUID(user.UserID)}
                                      disabled={clearingUUID}
                                      className="p-2 sm:p-3 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg hover:from-blue-500 hover:to-blue-600 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:transform-none shadow-lg"
                                      title={t.users.clearUUID}
                                    >
                                      <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white ${clearingUUID ? 'animate-spin' : ''}`} />
                                    </button>
                                    <button
                                      onClick={() => deleteUser(user)}
                                      className="p-2 sm:p-3 bg-gradient-to-br from-red-600 to-rose-600 rounded-lg hover:from-red-500 hover:to-rose-500 transition-all duration-300 transform hover:scale-105 shadow-lg"
                                      title={t.dashboard.delete}
                                    >
                                      <Trash2 className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white" />
                                    </button>
                                  </div>
                                )}
                              </div>
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
              <div className="relative z-10 text-center py-20">
                <div className="p-8 bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl inline-block shadow-lg">
                  <UserIcon className="h-20 w-20 text-gray-400 mx-auto mb-6" />
                  <p className="text-gray-600 text-xl font-semibold">{t.users.noResults}</p>
                </div>
              </div>
            )}
          </div>

          {/* Modal de edición */}
          {editingUser && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="relative bg-white/95 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-10 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="flex items-center justify-between mb-6 sm:mb-8">
                  <h3 className="text-2xl sm:text-3xl font-bold text-gray-900">{t.users.editUser}</h3>
                  <button
                    onClick={cancelEditing}
                    className="p-2 sm:p-3 bg-gradient-to-br from-red-500/20 to-rose-500/20 backdrop-blur-sm border border-red-500/30 rounded-xl text-red-500 hover:border-red-500/50 transition-all duration-300"
                  >
                    <X className="h-5 w-5 sm:h-6 sm:w-6" />
                  </button>
                </div>

                <div className="space-y-6 sm:space-y-8">
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

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end space-y-3 sm:space-y-0 sm:space-x-4 lg:space-x-6 mt-8 sm:mt-10">
                  <button
                    onClick={cancelEditing}
                    className="px-6 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-semibold text-gray-600 bg-white/50 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all duration-300"
                  >
                    {t.users.cancel}
                  </button>
                  <button
                    onClick={saveUser}
                    disabled={saving || !editForm.Username.trim()}
                    className="px-6 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-semibold text-white bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 rounded-xl hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-300 transform hover:-translate-y-0.5 disabled:transform-none shadow-lg hover:shadow-xl"
                  >
                    {saving ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-b-2 border-white mr-2 sm:mr-3"></div>
                        {t.users.saving}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 sm:h-5 sm:w-5 mr-2 sm:mr-3" />
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
              <div className="relative bg-white/95 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-10 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="flex items-center justify-between mb-6 sm:mb-8">
                  <h3 className="text-2xl sm:text-3xl font-bold text-gray-900">{t.users.createNewUser}</h3>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="p-2 sm:p-3 bg-gradient-to-br from-red-500/20 to-rose-500/20 backdrop-blur-sm border border-red-500/30 rounded-xl text-red-500 hover:border-red-500/50 transition-all duration-300"
                  >
                    <X className="h-5 w-5 sm:h-6 sm:w-6" />
                  </button>
                </div>

                <form onSubmit={handleCreateUser} className="space-y-6 sm:space-y-8">
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

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end space-y-3 sm:space-y-0 sm:space-x-4 lg:space-x-6 mt-8 sm:mt-10">
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className="px-6 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-semibold text-gray-600 bg-white/50 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all duration-300"
                    >
                      {t.users.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={createLoading || !createForm.username || !createForm.password}
                      className="px-6 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-semibold text-white bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 rounded-xl hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-300 transform hover:-translate-y-0.5 disabled:transform-none shadow-lg hover:shadow-xl"
                    >
                      {createLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-b-2 border-white mr-2 sm:mr-3"></div>
                          {t.users.creating}
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-2 sm:mr-3" />
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