'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react'
import HybridNavigation from '@/components/HybridNavigation'
import HybridProtectedRoute from '@/components/HybridProtectedRoute'
import HybridRoleGuard from '@/components/HybridRoleGuard'
import UserAutocomplete, {
  type UserAutocompleteItem,
} from '@/app/data/user-autocomplete'
import { useLanguage } from '@/contexts/LanguageContext'
import { useSession } from '@/contexts/SessionContext'
import AdminKubiosTable from './admin-kubios-table'
import { useAdminKubios } from './use-admin-kubios'

function StatusPanel({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-blue-200 bg-blue-50/60 px-6 py-12 text-center">
      <div className="mb-4 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
        <Calendar className="h-9 w-9 text-blue-500" />
      </div>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 max-w-xl text-sm font-medium text-slate-600">
        {message}
      </p>
    </div>
  )
}

function AdminKubiosContent() {
  const { t } = useLanguage()
  const { session } = useSession()
  const isAdmin = session?.user.role === 'admin'
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)

  const {
    participantsState,
    page,
    goNext,
    goPrevious,
    reloadMeasurements,
    reloadParticipants,
  } = useAdminKubios(isAdmin, selectedUserId)

  const participantItems = useMemo<UserAutocompleteItem[]>(
    () =>
      participantsState.participants.map((participant) => ({
        key: String(participant.userId),
        value: String(participant.userId),
        primary: participant.username,
        secondary: null,
      })),
    [participantsState.participants],
  )

  const handleParticipantChange = (next: string) => {
    if (next === 'all') {
      setSelectedUserId(null)
      return
    }
    const userId = Number(next)
    setSelectedUserId(Number.isSafeInteger(userId) ? userId : null)
  }

  const selectedValue =
    selectedUserId === null ? 'all' : String(selectedUserId)
  // La página del hook puede seguir perteneciendo a la selección anterior
  // durante el render que cambia `selectedUserId`; se oculta de inmediato.
  const selectionMatches = page.ownerUserId === selectedUserId
  const visibleMeasurements = selectionMatches ? page.measurements : []
  const visibleStatus = selectionMatches ? page.status : null
  const visibleHistory = selectionMatches ? page.history : []
  const visibleUnavailableCount = selectionMatches
    ? page.unavailableCount
    : 0
  const loading = page.phase === 'loading' || !selectionMatches
  const phaseError = selectionMatches && page.phase === 'error'
  const canGoPrevious = !loading && visibleHistory.length > 0
  const canGoNext =
    !loading && selectionMatches && page.nextCursor !== null
  const pageNumber = visibleHistory.length + 1
  const hasMeasurements = visibleMeasurements.length > 0

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden"
      style={{ colorScheme: 'light' }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-400 opacity-10 mix-blend-multiply blur-xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-indigo-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-1000"></div>
      </div>

      <HybridNavigation title={t.admin.kubios.title} showBackButton={true} />

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-2xl border border-gray-200/60 bg-white/90 p-5 shadow-xl backdrop-blur-xl sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 p-3 shadow-lg sm:p-4">
                <HeartPulse className="h-8 w-8 text-white sm:h-10 sm:w-10" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                  {t.admin.kubios.title}
                </h1>
                <p className="mt-1 text-sm text-gray-600 sm:text-base">
                  {t.admin.kubios.description}
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t.admin.kubios.adminOnly}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t.admin.kubios.participants}
                </p>
                <p className="mt-1 text-xl font-bold text-slate-900">
                  {participantsState.loading
                    ? '…'
                    : participantsState.participants.length}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t.admin.kubios.pageMeasurements}
                </p>
                <p
                  className="mt-1 text-xl font-bold text-slate-900"
                  data-testid="admin-kubios-page-count"
                >
                  {loading ? '…' : visibleMeasurements.length}
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="mb-6 rounded-2xl border border-gray-200/60 bg-white/90 p-4 shadow-xl backdrop-blur-xl sm:p-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,28rem)_1fr] lg:items-end">
            <UserAutocomplete
              items={participantItems}
              value={selectedValue}
              onChange={handleParticipantChange}
              label={t.admin.kubios.participantFilter}
              allUsersLabel={t.admin.kubios.allParticipants}
              placeholder={t.admin.kubios.searchParticipants}
              loading={participantsState.loading}
              error={participantsState.error}
            />
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 lg:justify-end">
              <Users className="h-4 w-4" />
              {t.admin.kubios.participants}
            </div>
          </div>

          {participantsState.error ? (
            <div
              role="alert"
              className="mt-4 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{t.admin.kubios.participantsError}</span>
              <button
                type="button"
                onClick={reloadParticipants}
                className="self-start rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700"
              >
                {t.admin.kubios.retryParticipants}
              </button>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-gray-200/60 bg-white/90 p-4 shadow-xl backdrop-blur-xl sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
                {t.admin.kubios.tableCaption}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrevious}
                disabled={!canGoPrevious}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                {t.admin.kubios.previous}
              </button>
              <span className="text-xs font-semibold text-slate-500">
                {t.admin.kubios.page} {pageNumber}
              </span>
              <button
                type="button"
                onClick={goNext}
                disabled={!canGoNext}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.admin.kubios.next}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {visibleStatus === 'stale' ? (
            <div
              role="status"
              className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <span>{t.admin.kubios.pageStatusStale}</span>
            </div>
          ) : null}

          {visibleStatus === 'pending' && hasMeasurements ? (
            <div
              role="status"
              className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800"
            >
              <RefreshCw className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <span>{t.admin.kubios.pageStatusPending}</span>
            </div>
          ) : null}

          {visibleStatus === 'unlinked' && hasMeasurements ? (
            <div
              role="status"
              className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <span>{t.admin.kubios.pageStatusUnlinked}</span>
            </div>
          ) : null}

          {phaseError ? (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-medium text-red-700 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{t.admin.kubios.loadError}</span>
              <button
                type="button"
                onClick={reloadMeasurements}
                className="inline-flex items-center gap-2 self-start rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700"
              >
                <RefreshCw className="h-4 w-4" />
                {t.admin.kubios.retry}
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-6 py-4 shadow-sm">
                <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
                <span className="text-sm font-medium text-slate-700">
                  {t.common.loading}
                </span>
              </div>
            </div>
          ) : hasMeasurements ? (
            <AdminKubiosTable
              measurements={visibleMeasurements}
              unavailableCount={visibleUnavailableCount}
            />
          ) : (
            <StatusPanel
              title={t.admin.kubios.title}
              message={
                visibleStatus === 'unlinked'
                  ? t.admin.kubios.pageStatusUnlinked
                  : visibleStatus === 'pending'
                    ? t.admin.kubios.pageStatusPending
                    : t.admin.kubios.empty
              }
            />
          )}
        </section>
      </main>
    </div>
  )
}

export default function AdminKubiosPage() {
  return (
    <HybridProtectedRoute>
      <HybridRoleGuard requiredRole="admin">
        <AdminKubiosContent />
      </HybridRoleGuard>
    </HybridProtectedRoute>
  )
}
