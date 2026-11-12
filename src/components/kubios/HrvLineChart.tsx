'use client'

/**
 * Shared HRV line chart used by the personal view (/kubios) and the admin
 * participant view (/admin/kubios, MT42). Kept separate so both surfaces draw
 * with the same visual language and behavior.
 */

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface ChartRow {
  time: number
  date: string
  readiness: number | null
  rmssd: number | null
  pnsIndex: number | null
  snsIndex: number | null
  heartRate: number | null
  hfPower: number | null
  lfPower: number | null
  vlfPower: number | null
}

export interface ChartLine {
  dataKey: keyof ChartRow
  name: string
  color: string
  dashed?: boolean
}

export default function HrvLineChart({
  rows,
  lines,
  yLabel,
  domain,
  height = 340,
}: {
  rows: ChartRow[]
  lines: ChartLine[]
  yLabel: string
  domain?: [number, number]
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 16, right: 24, left: 8, bottom: 32 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E1" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#334155', fontSize: 12 }}
          axisLine={{ stroke: '#94A3B8' }}
          tickLine={{ stroke: '#94A3B8' }}
        />
        <YAxis
          domain={domain}
          tick={{ fill: '#334155', fontSize: 12 }}
          axisLine={{ stroke: '#94A3B8' }}
          tickLine={{ stroke: '#94A3B8' }}
          label={{
            value: yLabel,
            angle: -90,
            position: 'insideLeft',
            style: { textAnchor: 'middle', fill: '#475569', fontSize: 12 },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#0F172A',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#E2E8F0',
          }}
        />
        <Legend wrapperStyle={{ paddingTop: '12px', fontSize: '13px' }} />
        {lines.map((line) => (
          <Line
            key={`${String(line.dataKey)}-${line.name}`}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.color}
            strokeWidth={2.5}
            strokeDasharray={line.dashed ? '6 4' : undefined}
            dot={{ r: 3, strokeWidth: 1 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
