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
  ScatterChart,
  Scatter,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts'

interface StudyChartsProps {
  exerciseData: any[]
  moodData: any[]
  hrvData: any[]
  insulinData: any[]
  mealData: any[]
}

export default function StudyCharts({ exerciseData, moodData, hrvData, insulinData, mealData }: StudyChartsProps) {
  
  // Función para convertir campos de texto a números
  const convertToNumber = (value: any, field: string) => {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      // Convertir intensidad de ejercicio a número
      if (field === 'intensity') {
        switch (value.toLowerCase()) {
          case 'bajo': return 1
          case 'moderado': return 2
          case 'alto': return 3
          default: return 1
        }
      }
      // Convertir dosis de insulina a número
      if (field === 'dose') {
        const num = parseFloat(value)
        return isNaN(num) ? 0 : num
      }
      // Convertir otros campos string a número
      const num = parseFloat(value)
      return isNaN(num) ? 0 : num
    }
    return 0
  }
  
  // Validar que tenemos datos para mostrar
  if (!exerciseData || exerciseData.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/70 text-lg">No hay datos de ejercicio disponibles para mostrar en los gráficos</p>
      </div>
    )
  }
  
  // Preparar datos para gráficos de correlación con mejor formateo de fechas
  const correlationData = exerciseData.map((exercise, index) => {
    const correspondingHrv = hrvData[index] || {}
    const correspondingMeal = mealData[index] || {}
    
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
      hrvReadiness: correspondingHrv.readiness_index || correspondingHrv.result?.readiness || 0,
      hrvRMSSD: correspondingHrv.rmssd || correspondingHrv.result?.rmssd_ms || 0,
      hrvRecovery: correspondingHrv.recovery || correspondingHrv.result?.recovery || 0,
      hrvStress: correspondingHrv.stress_index || correspondingHrv.result?.stress_index || 0,
      hrvPNS: correspondingHrv.pns_index || correspondingHrv.result?.pns_index || 0,
      hrvSNS: correspondingHrv.sns_index || correspondingHrv.result?.sns_index || 0,
      carbs: correspondingMeal.carbs || 0,
      moodValue: moodData[index]?.mood_value || 0,
      insulinDose: insulinData[index]?.dose || 0,
      userName: correspondingHrv.user_name || 'Usuario'
    }
  })

  // Datos para gráfico de barras - HRV promedio por intensidad de ejercicio
  const intensityHrvData = exerciseData.reduce((acc, exercise, index) => {
    const intensity = convertToNumber(exercise.intensity, 'intensity')
    const hrvValue = hrvData[index]?.readiness_index || hrvData[index]?.result?.readiness || 0
    
    if (!acc[intensity]) {
      acc[intensity] = { total: 0, count: 0, intensity: intensity }
    }
    
    acc[intensity].total += hrvValue
    acc[intensity].count += 1
    
    return acc
  }, {} as { [key: number]: { total: number, count: number, intensity: number } })
  
  const barData = (Object.values(intensityHrvData) as Array<{ total: number; count: number; intensity: number }>).map(item => ({
    intensidad: item.intensity,
    intensidadLabel: item.intensity === 1 ? 'Bajo' : item.intensity === 2 ? 'Moderado' : 'Alto',
    hrvPromedio: Math.round((item.total / item.count) * 100) / 100,
    cantidad: item.count
  })).sort((a, b) => a.intensidad - b.intensidad)

  // Datos para gráfico de barras de tendencias semanales
  const weeklyTrends = exerciseData.reduce((acc, exercise) => {
    // Usar date_time si date no existe
    const exerciseDate = exercise.date || exercise.date_time || new Date().toISOString()
    const week = Math.floor((new Date(exerciseDate).getTime() - new Date().getTime()) / (7 * 24 * 60 * 60 * 1000))
    if (!acc[week]) {
      acc[week] = { week: `Semana ${Math.abs(week)}`, exercise: 0, hrv: 0, mood: 0, count: 0 }
    }
    acc[week].exercise += exercise.duration || 0
    acc[week].hrv += hrvData[exerciseData.indexOf(exercise)]?.readiness_index || hrvData[exerciseData.indexOf(exercise)]?.result?.readiness || 0
    acc[week].mood += moodData[exerciseData.indexOf(exercise)]?.mood_value || 0
    acc[week].count += 1
    return acc
  }, {} as any)

  const weeklyData = Object.values(weeklyTrends).map((week: any) => ({
    ...week,
    exercise: week.exercise / week.count,
    hrv: week.hrv / week.count,
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

  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

  return (
    <div className="space-y-8">
      {/* Gráfico de Evolución Temporal: Métricas de HRV */}
      <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
        <h3 className="text-xl font-bold text-blue-600 mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg mr-3">
            <LineChart className="h-5 w-5 text-white" />
          </div>
          Evolución Temporal: Métricas de HRV
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Análisis temporal de las métricas de variabilidad cardíaca.
          <strong className="text-blue-400"> Eje X:</strong> Fechas | 
          <strong className="text-blue-400"> Eje Y:</strong> Valores de HRV
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
              label={{ value: 'Valores HRV', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#9ca3af' } }}
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
                  hrvReadiness: 'HRV Readiness (%)',
                  hrvRMSSD: 'HRV RMSSD (ms)',
                  hrvStress: 'HRV Stress Index'
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
              dataKey="hrvReadiness" 
              stroke="#3b82f6" 
              strokeWidth={3}
              dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
              name="HRV Readiness"
            />
            <Line 
              type="monotone" 
              dataKey="hrvRMSSD" 
              stroke="#8B5CF6" 
              strokeWidth={3}
              dot={{ fill: '#8B5CF6', strokeWidth: 2, r: 4 }}
              name="HRV RMSSD"
            />
            <Line 
              type="monotone" 
              dataKey="hrvStress" 
              stroke="#EF4444" 
              strokeWidth={3}
              dot={{ fill: '#EF4444', strokeWidth: 2, r: 4 }}
              name="HRV Stress"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

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

      {/* Gráfico de Barras: HRV Promedio por Intensidad */}
      <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
        <h3 className="text-xl font-bold text-blue-600 mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg mr-3">
            <BarChart className="h-5 w-5 text-white" />
          </div>
          HRV Promedio por Intensidad de Ejercicio
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Análisis que muestra el HRV promedio según la intensidad del ejercicio realizado.
          <strong className="text-green-400"> Eje X:</strong> Intensidad del ejercicio | 
          <strong className="text-green-400"> Eje Y:</strong> HRV Readiness Promedio (%)
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={barData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="intensidadLabel" 
              stroke="#9ca3af"
              fontSize={12}
              label={{ value: 'Intensidad del Ejercicio', position: 'insideBottom', offset: -10, style: { textAnchor: 'middle', fill: '#9ca3af' } }}
            />
            <YAxis 
              stroke="#9ca3af"
              fontSize={12}
              label={{ value: 'HRV Readiness Promedio (%)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#9ca3af' } }}
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
                if (name === 'hrvPromedio') return [`${value}%`, 'HRV Promedio']
                if (name === 'cantidad') return [`${value}`, 'Sesiones']
                return [value, name]
              }}
              labelFormatter={(label) => `Intensidad: ${label}`}
            />
            <Bar 
              dataKey="hrvPromedio" 
              fill="#10B981" 
              name="hrvPromedio"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Gráfico de Tendencias Semanales */}
      <div className="relative bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
        <h3 className="text-xl font-bold text-blue-600 mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg mr-3">
            <BarChart className="h-5 w-5 text-white" />
          </div>
          Análisis Semanal: Métricas de HRV y Actividad
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Análisis semanal que muestra las tendencias promedio de las métricas de HRV y actividad física.
          <strong className="text-purple-400"> Eje X:</strong> Semanas | 
          <strong className="text-purple-400"> Eje Y:</strong> Valores promedio de HRV y ejercicio
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
                  hrv: 'HRV Readiness Promedio (%)',
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
              dataKey="hrv" 
              fill="#3b82f6" 
              name="hrv"
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
