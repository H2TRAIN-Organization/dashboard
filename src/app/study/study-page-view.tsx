'use client'
import { useEffect, useState } from 'react'
import Navigation from '@/components/Navigation'
import ProtectedRoute from '@/components/ProtectedRoute'
import StudyCharts from '@/components/StudyCharts'
import { useLanguage } from '@/contexts/LanguageContext'
import { studyAdminApi } from '@/lib/study-admin-client'
import { studyAdminDictionary } from '@/lib/study-admin-dictionary'
import { STUDY_PERIODS, type StudyPeriod, type StudyResponse } from '@/lib/study-contract'

/**
 * Vista original de Estudio, conservada sin borrar su código fuente. Ya no
 * está montada en ninguna ruta: `page.tsx` responde 404 (ver README.md).
 * Para reactivarla, vuelve a montar este componente como página.
 */
export function StudyPageView() {
  const { language } = useLanguage()
  const text = studyAdminDictionary[language === 'en' ? 'en' : 'es']
  const [period, setPeriod] = useState<StudyPeriod>('90d')
  const [revision, setRevision] = useState(0)
  const requestKey = JSON.stringify([period, revision])
  const [result, setResult] = useState<{ key: string; data: StudyResponse | null; error: boolean } | null>(null)
  const loading = result?.key !== requestKey
  const data = !loading ? result?.data : null
  const error = !loading && result?.error
  useEffect(() => {
    const controller = new AbortController()
    studyAdminApi.study(period, controller.signal).then(next => { if (!controller.signal.aborted) setResult({ key: requestKey, data: next, error: false }) })
      .catch(() => { if (!controller.signal.aborted) setResult({ key: requestKey, data: null, error: true }) })
    return () => controller.abort()
  }, [period, requestKey])
  return <ProtectedRoute><Navigation title={text.study} /><main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <h1 className="text-3xl font-bold">{text.study}</h1>
    <label className="block">{text.period}<select className="ml-3 rounded border p-2" value={period} onChange={e => setPeriod(e.target.value as StudyPeriod)}>
      {STUDY_PERIODS.map(p => <option key={p} value={p}>{p === 'all' ? text.all : `${p.slice(0,-1)} ${text.days}`}</option>)}
    </select></label>
    <p className="rounded-xl border border-blue-200 bg-blue-50 p-4">{text.caveat}</p>
    <p className="text-sm text-slate-600">{text.normalization}</p>
    {loading && <p role="status">{text.loading}</p>}
    {error && <div role="alert">{text.error} <button className="rounded border p-2" onClick={() => setRevision(v=>v+1)}>{text.retry}</button></div>}
    {data && <>
      <p role="status">{text.source}: {text[data.sources.kubios]} · {text.health}: {data.records.exercise + data.records.mood + data.records.insulin + data.records.food} · Kubios: {data.records.kubios}</p>
      {data.excludedRecords > 0 && <p role="status">{text.excluded}: {data.excludedRecords}</p>}
      <div className="grid gap-4 md:grid-cols-3">{(Object.keys(data.associations) as (keyof StudyResponse['associations'])[]).filter(key => key !== 'durationRmssd' || data.sources.kubios !== 'restricted').map(key => {
        const association = data.associations[key]
        return <section className="rounded-xl border bg-white p-5" key={key}><h2 className="font-semibold">{text[key]}</h2>
          <p className="my-2 text-2xl">{association.coefficient === null ? text.noData : `r = ${association.coefficient.toFixed(2)}`}</p>
          <p className="text-sm">n = {association.sampleSize} {text.sample} · {association.participants} {text.people}</p></section>
      })}</div>
      <StudyCharts days={data.days} />
    </>}
  </main></ProtectedRoute>
}
