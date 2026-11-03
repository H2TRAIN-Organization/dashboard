'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts'

interface StudyChartsProps {
  exerciseData: any[]
  moodData: any[]
}

export default function StudyCharts({ exerciseData, moodData }: StudyChartsProps) {

  // Validar que tenemos datos para mostrar
  if (!exerciseData || exerciseData.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/70 text-lg">No hay datos de ejercicio disponibles para mostrar en los gráficos</p>
      </div>
    )
  }

  // Preparar datos para los gráficos de actividad y bienestar
  const correlationData = exerciseData.map((exercise, index) => {
    // Formatear fecha para mostrar
    const exerciseDate = exercise.date || exercise.date_time || new Date().toISOString()
    const formattedDate = new Date(exerciseDate).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })

    return {
      date: formattedDate,
      fullDate: exerciseDate,
      exerciseType: exercise.exercise_type || 'Ejercicio',
      exerciseDuration: exercise.duration || 30, // Duración en minutos
      moodValue: moodData[index]?.mood_value || 0
    }
  })

  // Datos para gráfico de barras de tendencias semanales
  const weeklyTrends = exerciseData.reduce((acc, exercise) => {
    // Usar date_time si date no existe
    const exerciseDate = exercise.date || exercise.date_time || new Date().toISOString()
    const week = Math.floor((new Date(exerciseDate).getTime() - new Date().getTime()) / (7 * 24 * 60 * 60 * 1000))
    if (!acc[week]) {
      acc[week] = { week: `Semana ${Math.abs(week)}`, exercise: 0, mood: 0, count: 0 }
    }
    acc[week].exercise += exercise.duration || 0
    acc[week].mood += moodData[exerciseData.indexOf(exercise)]?.mood_value || 0
    acc[week].count += 1
    return acc
  }, {} as any)

  const weeklyData = Object.values(weeklyTrends).map((week: any) => ({
    ...week,
    exercise: week.exercise / week.count,
    mood: week.mood / week.count
  }))

  // Datos para gráfico de distribución de intensidad de ejercicio
  const exerciseIntensity = exerciseData.reduce((acc, exercise) => {
    const intensity = exercise.intensity || 'Moderado'
    acc[intensity] = (acc[intensity] || 0) + 1
    return acc
  }, {} as any)

  const intensityData = Object.entries(exerciseIntensity).map(([intensity, count]) => ({
    name: intensity,
    value: count,
    color: intensity === 'Bajo' ? '#10b981' : intensity === 'Moderado' ? '#f59e0b' : '#ef4444'
  }))

  return (
    <div className="space-y-8">
      {/* Gráfico de Evolución Temporal: Ejercicio y Estado de Ánimo */}
      <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
        <h3 className="text-xl font-bold text-blue-600 mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg mr-3">
            <LineChart className="h-5 w-5 text-white" />
          </div>
          Evolución Temporal: Ejercicio y Estado de Ánimo
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Análisis temporal de la actividad física y el bienestar emocional.
          <strong className="text-green-400"> Eje X:</strong> Fechas |
          <strong className="text-green-400"> Eje Y:</strong> Duración de ejercicio y estado de ánimo
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={correlationData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="date"
              stroke="#9ca3af"
              fontSize={12}
              label={{ value: 'Fecha', position: 'insideBottom', offset: -10, style: { textAnchor: 'middle', fill: '#9ca3af' } }}
            />
            <YAxis
              stroke="#9ca3af"
              fontSize={12}
              label={{ value: 'Valores', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#9ca3af' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '8px',
                color: 'white'
              }}
              itemStyle={{ color: 'white' }}
              labelStyle={{ color: 'white' }}
              formatter={(value, name) => {
                const labels: any = {
                  exerciseDuration: 'Duración Ejercicio (min)',
                  moodValue: 'Estado de Ánimo (/10)'
                }
                return [`${value}`, labels[name] || name]
              }}
              labelFormatter={(label) => `Fecha: ${label}`}
            />
            <Legend
              wrapperStyle={{
                paddingTop: '20px',
                fontSize: '14px',
                color: '#374151'
              }}
            />
            <Line
              type="monotone"
              dataKey="exerciseDuration"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
              name="Duración Ejercicio"
            />
            <Line
              type="monotone"
              dataKey="moodValue"
              stroke="#f59e0b"
              strokeWidth={3}
              dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }}
              name="Estado de Ánimo"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Gráfico de Tendencias Semanales */}
      <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
        <h3 className="text-xl font-bold text-blue-600 mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg mr-3">
            <BarChart className="h-5 w-5 text-white" />
          </div>
          Análisis Semanal: Actividad y Estado de Ánimo
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Análisis semanal que muestra las tendencias promedio de actividad física y estado de ánimo.
          <strong className="text-purple-400"> Eje X:</strong> Semanas |
          <strong className="text-purple-400"> Eje Y:</strong> Valores promedio de ejercicio y estado de ánimo
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={weeklyData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="week"
              stroke="#9ca3af"
              fontSize={12}
              label={{ value: 'Semana', position: 'insideBottom', offset: -10, style: { textAnchor: 'middle', fill: '#9ca3af' } }}
            />
            <YAxis
              stroke="#9ca3af"
              fontSize={12}
              label={{ value: 'Valores Promedio', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#9ca3af' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '8px',
                color: 'white'
              }}
              itemStyle={{ color: 'white' }}
              labelStyle={{ color: 'white' }}
              formatter={(value, name) => {
                const labels: any = {
                  exercise: 'Ejercicio Promedio (min)',
                  mood: 'Estado de Ánimo Promedio (/10)'
                }
                return [`${Math.round(Number(value) * 100) / 100}`, labels[name] || name]
              }}
              labelFormatter={(label) => `Semana: ${label}`}
            />
            <Bar
              dataKey="exercise"
              fill="#10b981"
              name="exercise"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="mood"
              fill="#f59e0b"
              name="mood"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Gráfico de Distribución de Intensidad de Ejercicio */}
      <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
        <h3 className="text-xl font-bold text-blue-600 mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg mr-3">
            <PieChart className="h-5 w-5 text-white" />
          </div>
          Distribución de Intensidades de Ejercicio
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Análisis de la distribución de intensidades de ejercicio realizadas durante el período de estudio.
          <strong className="text-orange-400"> Cada sector:</strong> Porcentaje de sesiones con esa intensidad
        </p>
        <div className="flex items-center justify-center">
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={intensityData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                outerRadius={120}
                fill="#8884d8"
                dataKey="value"
              >
                {intensityData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: 'white'
                }}
                itemStyle={{ color: 'white' }}
                labelStyle={{ color: 'white' }}
                formatter={(value, name) => [`${value} sesiones`, 'Cantidad']}
                labelFormatter={(label) => `Intensidad: ${label}`}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
