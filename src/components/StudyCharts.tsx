'use client'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useOptionalLanguage } from '@/contexts/LanguageContext'
import { studyAdminDictionary } from '@/lib/study-admin-dictionary'
import type { StudyDay } from '@/lib/study-normalization'
export default function StudyCharts({ days }: { days: readonly StudyDay[] }) {
  const { language } = useOptionalLanguage()
  const text = studyAdminDictionary[language === 'en' ? 'en' : 'es']
  const persons = [...new Set(days.map(d => d.person))]
  if (!days.length) return <p>{text.empty}</p>
  return <div className="space-y-6">{persons.map((person, index) => (
    <section key={person} className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-semibold">{text.participant} {index + 1}</h3>
      <div role="img" aria-label={`${text.exercise} / ${text.mood} · ${text.participant} ${index + 1}`}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={days.filter(d => d.person === person)} margin={{ top: 10, right: 15, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" /><YAxis yAxisId="minutes" /><YAxis yAxisId="mood" orientation="right" />
            <Tooltip /><Line yAxisId="minutes" dataKey="exerciseDuration" name={text.exercise} stroke="#2563eb" connectNulls={false} />
            <Line yAxisId="mood" dataKey="moodValue" name={text.mood} stroke="#059669" connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  ))}</div>
}
