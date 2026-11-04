'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import Navigation from '@/components/Navigation'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleGuard from '@/components/RoleGuard'
import { useLanguage } from '@/contexts/LanguageContext'
import { studyAdminApi } from '@/lib/study-admin-client'
import { studyAdminDictionary } from '@/lib/study-admin-dictionary'
import type { AdminKubiosPage, AdminKubiosParticipant } from '@/lib/admin-kubios-contract'
export default function AdminKubios({ userId }: { userId?: string }) {
  const { language } = useLanguage()
  const text = studyAdminDictionary[language === 'en' ? 'en' : 'es']
  const [search, setSearch] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [status, setStatus] = useState('all'); const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const requestKey = JSON.stringify([userId, search, from, to, status, page, revision])
  const [result, setResult] = useState<{ key: string; data: AdminKubiosPage | AdminKubiosParticipant | null; error: boolean } | null>(null)
  const loading = result?.key !== requestKey
  const error = !loading && result?.error
  const data = !loading && result?.data && 'participants' in result.data ? result.data : null
  const detail = !loading && result?.data && 'results' in result.data ? result.data : null
  useEffect(() => {
    const controller = new AbortController()
    const pending = userId ? studyAdminApi.participant(userId, from, to, controller.signal).then(value=>{ if (!controller.signal.aborted) setResult({ key: requestKey, data: value, error: false }) })
      : studyAdminApi.participants({ search, from, to, status, page, pageSize: 25 }, controller.signal).then(value=>{ if (!controller.signal.aborted) setResult({ key: requestKey, data: value, error: false }) })
    pending.catch(()=>{ if (!controller.signal.aborted) setResult({ key: requestKey, data: null, error: true }) })
    return () => controller.abort()
  }, [userId, search, from, to, status, page, requestKey])
  const dateParams = new URLSearchParams(); if (from) dateParams.set('from',from); if (to) dateParams.set('to',to)
  return <ProtectedRoute><RoleGuard requiredRole="admin"><Navigation title={text.kubios} />
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8"><h1 className="text-3xl font-bold">{text.kubios}{userId ? ` · UserID ${userId}` : ''}</h1>
      {userId && <Link className="text-blue-700 underline" href="/admin/kubios">{text.back}</Link>}
      <div className="flex flex-wrap gap-4 rounded-xl border p-4">
        {!userId && <><label>{text.search}<input className="mt-1 block w-44 rounded border p-2" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} /></label>
        <label>{text.status}<select className="mt-1 block rounded border p-2" value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}>{(['all','pending','empty','ready','stale'] as const).map(s=><option key={s} value={s}>{text[s]}</option>)}</select></label></>}
        <label>{text.from}<input type="date" className="mt-1 block rounded border p-2" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}} /></label>
        <label>{text.to}<input type="date" className="mt-1 block rounded border p-2" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}} /></label>
      </div>
      {loading && <p role="status">{text.loading}</p>}
      {error && <div role="alert">{text.error} <button className="rounded border p-2" onClick={()=>setRevision(v=>v+1)}>{text.retry}</button></div>}
      {data && <><p>{data.total} {text.people} · {data.page}</p><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['UserID',text.participant,text.status,text.count,text.synced,''].map((h,i)=><th className="p-3" key={i}>{h}</th>)}</tr></thead><tbody>
        {data.participants.map(p=><tr className="border-t" key={p.userId}><td className="p-3">{p.userId}</td><td className="p-3">{p.username}</td><td className="p-3">{text[p.status]}</td><td className="p-3">{p.measurementCount}</td><td className="p-3">{p.syncedAt ?? '—'}</td><td className="p-3"><Link className="text-blue-700 underline" href={`/admin/kubios/participants/${p.userId}`}>{text.detail}</Link></td></tr>)}
      </tbody></table></div>{!data.total && <p>{text.empty}</p>}
      <div className="flex gap-3"><button className="rounded border p-2 disabled:opacity-40" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>{text.previous}</button><button className="rounded border p-2 disabled:opacity-40" disabled={page*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>{text.next}</button></div></>}
      {detail && <><h2 className="text-xl font-semibold">{detail.username}</h2><p>{text.status}: {text[detail.status]} · {text.synced}: {detail.syncedAt ?? '—'} · {text.count}: {detail.measurementCount}</p>
        <a className="inline-block rounded bg-blue-700 px-4 py-2 text-white" href={`/api/admin/kubios/participants/${detail.userId}/export?${dateParams}`}>{text.export}</a>
        {detail.results.length > 0 ? <><div role="img" aria-label="RMSSD · UTC"><ResponsiveContainer width="100%" height={300}><LineChart data={[...detail.results].reverse().filter(r=>r.measured_timestamp)}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="measured_timestamp" tickFormatter={v=>String(v).slice(0,10)}/><YAxis/><Tooltip/><Line dataKey="result.rmssd_ms" name="RMSSD (ms)" stroke="#2563eb" connectNulls={false}/></LineChart></ResponsiveContainer></div>
        <h2 className="text-xl font-semibold">{text.details}</h2><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{[text.date,'RMSSD (ms)','Readiness (%)','PNS','SNS'].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{detail.results.map((r,i)=><tr className="border-t" key={i}><td className="p-3">{r.measured_timestamp ?? text.missing}</td>{[r.result?.rmssd_ms,r.result?.readiness,r.result?.pns_index,r.result?.sns_index].map((v,j)=><td className="p-3" key={j}>{v ?? '—'}</td>)}</tr>)}</tbody></table></div></> : <p>{text.empty}</p>}
      </>}
    </main></RoleGuard></ProtectedRoute>
}
