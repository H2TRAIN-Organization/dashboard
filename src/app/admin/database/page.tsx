'use client'

import { useCallback, useEffect, useState } from 'react'
import { Database, Download, RefreshCw, Table } from 'lucide-react'
import HybridProtectedRoute from '@/components/HybridProtectedRoute'
import HybridRoleGuard from '@/components/HybridRoleGuard'
import HybridNavigation from '@/components/HybridNavigation'
import { errorMessage } from '@/lib/api-client'
import { databaseApi, saveDatabaseDownload, type DatabaseStats, type DatabasePage } from '@/lib/admin-database-client'
import { databaseDictionary } from '@/lib/admin-database-dictionary'
import { useSession } from '@/contexts/SessionContext'
import { useLanguage } from '@/contexts/LanguageContext'

const button = 'rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-50'
const input = 'min-w-0 rounded-lg border border-slate-300 bg-white p-3 text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700'
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7'

export default function AdminDatabasePage() {
  const { language } = useLanguage()
  const { session } = useSession()
  const text = databaseDictionary[language === 'en' ? 'en' : 'es']
  const [stats, setStats] = useState<DatabaseStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [table, setTable] = useState('users')
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState<DatabasePage | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const [action, setAction] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')

  const refreshStats = useCallback(async () => {
    setStatsLoading(true); setStatsError(null)
    try { setStats(await databaseApi.stats()) }
    catch (caught) { setStatsError(errorMessage(caught)) }
    finally { setStatsLoading(false) }
  }, [])
  useEffect(() => {
    if (session?.user.role !== 'admin') return
    let active = true
    databaseApi.stats().then(result => {
      if (active) { setStats(result); setStatsError(null) }
    }).catch(caught => {
      if (active) setStatsError(errorMessage(caught))
    }).finally(() => {
      if (active) setStatsLoading(false)
    })
    return () => { active = false }
  }, [session])

  async function browse(offset = 0) {
    setPageLoading(true); setPage(null); setError(null)
    try { setPage(await databaseApi.page(table, pageSize, offset)) }
    catch (caught) { setError(errorMessage(caught)) }
    finally { setPageLoading(false) }
  }
  async function exportTable(format: 'json' | 'csv') {
    setAction(format); setError(null); setMessage(null)
    try { saveDatabaseDownload(await databaseApi.exportTable(table, format)); setMessage(text.success) }
    catch (caught) { setError(errorMessage(caught)) }
    finally { setAction(null) }
  }
  async function copy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setMessage(null)
    if (password.length < 12 || password !== confirmation) { setError(text.mismatch); return }
    setAction('copy')
    try { saveDatabaseDownload(await databaseApi.logicalCopy(password)); setMessage(text.success) }
    catch (caught) { setError(errorMessage(caught)) }
    finally { setPassword(''); setConfirmation(''); setAction(null) }
  }

  const columns = page ? [...new Set(page.data.flatMap(row => Object.keys(row)))] : []
  const status = stats ? text[stats.status] : text.unknown
  const locale = language === 'en' ? 'en-GB' : 'es-ES'
  return <HybridProtectedRoute><HybridRoleGuard requiredRole="admin">
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ colorScheme: 'light' }}>
      <HybridNavigation title={text.title} showBackButton />
      <main className="mx-auto max-w-7xl space-y-7 px-4 py-8 sm:px-6">
        <header><h1 className="flex items-center gap-3 text-3xl font-bold"><Database aria-hidden="true" />{text.title}</h1><p className="mt-3 text-slate-600">{text.description}</p></header>
        <nav aria-label={text.title} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <a className={button} href="#explorer"><Table className="mr-2 inline h-5 w-5" aria-hidden="true" />{text.explorer}</a>
          <a className={button} href="#exports"><Download className="mr-2 inline h-5 w-5" aria-hidden="true" />{text.exports}</a>
          <a className={button} href="#logical-copy"><Database className="mr-2 inline h-5 w-5" aria-hidden="true" />{text.copy}</a>
          <button className={button} disabled={statsLoading} onClick={() => void refreshStats()}><RefreshCw className="mr-2 inline h-5 w-5" aria-hidden="true" />{statsLoading ? text.loading : text.refresh}</button>
        </nav>
        <section className={panel} aria-busy={statsLoading} aria-label={text.refresh}>
          <p role="status" className="font-semibold">{statsLoading ? text.loading : statsError ? text.failedAttempt : status}</p>
          {statsError && <p role="alert" className="mt-2 text-red-700">{statsError}</p>}
          {stats && <><p className="mt-2">{stats.accessibleCount} / {stats.totalCount} {text.available} · {stats.totalRecords.toLocaleString(locale)} {text.records}</p><p className="mt-2 text-sm text-slate-600">{text.observed}: <time dateTime={stats.observedAt}>{new Date(stats.observedAt).toLocaleString(locale)}</time></p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{stats.tables.map(item => <li key={item.name} className="rounded-lg bg-slate-50 p-3"><span className="font-mono">{item.name}</span>: {item.accessible ? `${item.recordCount.toLocaleString(locale)} ${text.records}` : text.unavailable}</li>)}</ul></>}
        </section>
        {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-800">{message}</p>}
        {action && <p role="status">{text.busy}</p>}
        <section id="explorer" className={panel} aria-busy={pageLoading}>
          <h2 className="text-2xl font-bold">{text.explorer}</h2>
          <form className="my-5 flex flex-wrap items-end gap-4" onSubmit={event => { event.preventDefault(); void browse() }}>
            <label className="grid gap-2">{text.table}<select className={input} value={table} disabled={pageLoading || action !== null} onChange={event => { setTable(event.target.value); setPage(null) }}>{(stats?.tables ?? [{ name: 'users', accessible: true }]).map(item => <option key={item.name} value={item.name} disabled={!item.accessible}>{item.name}</option>)}</select></label>
            <label className="grid gap-2">{text.pageSize}<select className={input} value={pageSize} disabled={pageLoading} onChange={event => { setPageSize(Number(event.target.value)); setPage(null) }}>{[25, 50, 100, 250].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
            <button className={button} disabled={pageLoading} type="submit">{pageLoading ? text.loading : text.browse}</button>
          </form>
          {page && <>
            <p className="mb-3" role="status">{text.showing} {page.data.length === 0 ? 0 : page.offset + 1}–{page.offset + page.returnedRecords} {text.of} {page.totalRecords.toLocaleString(locale)}</p>
            {page.data.length === 0 ? <p>{text.empty}</p> : <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200" tabIndex={0} role="region" aria-label={`${text.table}: ${page.tableName}`}><table className="w-full border-collapse text-left text-sm"><thead className="sticky top-0 bg-slate-100"><tr>{columns.map(column => <th key={column} scope="col" className="whitespace-nowrap border-b p-3">{column}</th>)}</tr></thead><tbody>{page.data.map((row, index) => <tr key={String(row.UserID ?? row.id ?? index)} className="odd:bg-slate-50">{columns.map(column => <td key={column} className="max-w-xs break-words border-b p-3">{row[column] == null ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>}
            <div className="mt-4 flex flex-wrap gap-3"><button className={button} disabled={pageLoading || page.offset === 0} onClick={() => void browse(Math.max(0, page.offset - pageSize))}>{text.previous}</button><button className={button} disabled={pageLoading || !page.hasMore} onClick={() => void browse(page.offset + page.returnedRecords)}>{text.next}</button></div>
          </>}
        </section>
        <section id="exports" className={panel}><h2 className="text-2xl font-bold">{text.exports}</h2><p className="my-3 text-slate-600">{text.exportDescription}</p><p className="mb-4">{text.table}: <strong>{table}</strong></p><div className="flex flex-wrap gap-3"><button className={button} disabled={action !== null} onClick={() => void exportTable('csv')}>CSV</button><button className={button} disabled={action !== null} onClick={() => void exportTable('json')}>JSON</button></div></section>
        <section id="logical-copy" className={panel}><h2 className="text-2xl font-bold">{text.copy}</h2><p className="mt-3 text-slate-600">{text.copyDescription}</p><p className="mt-3 text-slate-600">{text.recovery}</p><form onSubmit={event => void copy(event)} className="mt-5 grid max-w-lg gap-4"><label className="grid gap-2">{text.password}<input className={input} type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={action !== null} /></label><label className="grid gap-2">{text.confirm}<input className={input} type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={action !== null} /></label><button type="submit" className={button} disabled={action !== null}>{action === 'copy' ? text.busy : text.downloadCopy}</button></form></section>
      </main>
    </div>
  </HybridRoleGuard></HybridProtectedRoute>
}
