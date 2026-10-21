'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase, User, InsulinData, FoodData, ExerciseData, PeriodRecord, MoodData } from '@/lib/supabase'
import { Download, Activity, Heart, Calendar, User as UserIcon, Filter, TrendingUp, TrendingDown, Clock, Pill, Utensils, Dumbbell, CalendarDays, Smile, ChevronDown, ChevronUp, Eye, EyeOff, Database, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useAppAuth } from '@/contexts/AppAuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
import LanguageSelector from '@/components/LanguageSelector'

export default function DataPage() {
  const { user } = useAuth()
  const { user: appUser } = useAppAuth()
  const { t } = useLanguage()
  
  const [insulinData, setInsulinData] = useState<InsulinData[]>([])
  const [foodData, setFoodData] = useState<FoodData[]>([])
  const [exerciseData, setExerciseData] = useState<ExerciseData[]>([])
  const [periodData, setPeriodData] = useState<PeriodRecord[]>([])
  const [moodData, setMoodData] = useState<MoodData[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [selectedUser, setSelectedUser] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [timeRange, setTimeRange] = useState<string>('all')
  const [selectedDataType, setSelectedDataType] = useState<string>('all')
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())
  const [showAllRecords, setShowAllRecords] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState<string>('')
  
  // Determinar si es un usuario individual o administrador
  const isIndividualUser = appUser && !user
  const currentUserId = appUser?.UserID?.toString()
  const currentUsername = appUser?.Username
  
  // Estados para el timepicker personalizado
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)
  const [datePicker, setDatePicker] = useState(new Date())
  const datePickerRef = useRef<HTMLButtonElement>(null)
  const datePickerPortalRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const [datePickerPosition, setDatePickerPosition] = useState<{ top: number; left: number; width: number } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setLoadingProgress(0)
      
      // Construir parámetros para la API
      const params = new URLSearchParams()
      
      // Para usuarios individuales, siempre filtrar por su username
      if (isIndividualUser && currentUsername) {
        params.append('selectedUser', currentUsername)
      } else {
        // Para administradores, usar el usuario seleccionado
        params.append('selectedUser', selectedUser)
      }
      
      params.append('timeRange', timeRange)
      if (dateFilter) {
        params.append('dateFilter', dateFilter)
      }

      setLoadingProgress(20)
      
      // Llamar al endpoint que descifra los datos con timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 segundos timeout
      
      setLoadingProgress(40)
      
      const response = await fetch(`/api/decrypted-data?${params}`, {
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
      
      clearTimeout(timeoutId)
      setLoadingProgress(60)
      
      if (!response.ok) {
        throw new Error(`Error al obtener datos: ${response.status}`)
      }

      const data = await response.json()
      setLoadingProgress(80)
      
      // Los datos ya vienen descifrados del servidor
      setInsulinData(data.insulinData || [])
      setFoodData(data.foodData || [])
      setExerciseData(data.exerciseData || [])
      setPeriodData(data.periodData || [])
      setMoodData(data.moodData || [])
      
      setLoadingProgress(100)
      
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedUser, dateFilter, timeRange, isIndividualUser, currentUsername])

  const fetchUsers = useCallback(async () => {
    try {
      // Para usuarios individuales, solo cargar su propio usuario
      if (isIndividualUser && currentUsername) {
        const { data: result, error } = await supabase
          .from('users')
          .select('*')
          .eq('Username', currentUsername)
          .single()

        if (error) throw error
        setUsers(result ? [result] : [])
      } else {
        // Para administradores, cargar todos los usuarios
        const { data: result, error } = await supabase
          .from('users')
          .select('*')
          .order('Username')

        if (error) throw error
        setUsers(result || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }, [isIndividualUser, currentUsername])

  useEffect(() => {
    fetchData()
    fetchUsers()
  }, [fetchData, fetchUsers])

  // Cerrar calendario al hacer click fuera y recalcular posición al hacer scroll/resize
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      // Calendario (portal)
      if (isDatePickerOpen && datePickerPortalRef.current?.contains(target)) return
      if (isDatePickerOpen) setIsDatePickerOpen(false)
    }

    const updateDatePickerPosition = () => {
      if (datePickerRef.current && isDatePickerOpen) {
        const rect = datePickerRef.current.getBoundingClientRect()
        setDatePickerPosition({
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX,
          width: Math.max(rect.width, 320) // Mínimo 320px de ancho
        })
      }
    }

    // Solo agregar listeners si el calendario está abierto
    if (isDatePickerOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('scroll', updateDatePickerPosition, true)
      window.addEventListener('resize', updateDatePickerPosition)
      updateDatePickerPosition()
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('scroll', updateDatePickerPosition, true)
      window.removeEventListener('resize', updateDatePickerPosition)
    }
  }, [isDatePickerOpen])

  const getUserEmail = (username: string) => {
    return username || 'Usuario desconocido'
  }

  const toggleUserExpansion = (userId: string) => {
    const newExpanded = new Set(expandedUsers)
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId)
    } else {
      newExpanded.add(userId)
    }
    setExpandedUsers(newExpanded)
  }

  const toggleShowAllRecords = (userId: string) => {
    const newShowAll = new Set(showAllRecords)
    if (newShowAll.has(userId)) {
      newShowAll.delete(userId)
    } else {
      newShowAll.add(userId)
    }
    setShowAllRecords(newShowAll)
  }

  const clearFilters = () => {
    setSelectedUser('all')
    setDateFilter('')
    setTimeRange('all')
    setSelectedDataType('all')
  }

  // Funciones para el calendario personalizado
  const formatDateForInput = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const formatDisplayDate = (date: Date) => {
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }

  const handleDateChange = (date: Date) => {
    // Crear una nueva fecha en zona horaria local para evitar problemas de UTC
    const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    setDatePicker(localDate)
    setDateFilter(formatDateForInput(localDate))
  }

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  const navigateMonth = (date: Date, direction: 'prev' | 'next') => {
    const newDate = new Date(date)
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1)
    } else {
      newDate.setMonth(newDate.getMonth() + 1)
    }
    return newDate
  }

  const selectDate = (date: Date) => {
    const dateString = formatDateForInput(date)
    setDateFilter(dateString)
    setIsDatePickerOpen(false)
  }

  const isToday = (date: Date) => {
    const today = new Date()
    return date.toDateString() === today.toDateString()
  }

  const isSelected = (date: Date) => {
    const dateString = formatDateForInput(date)
    return dateFilter === dateString
  }

  // Portal simple para renderizar en document.body (evita clipping y stacking contexts)
  const Portal = ({ children }: { children: any }) => {
    if (typeof window === 'undefined') return null
    return createPortal(children, document.body)
  }

  // Componente de calendario personalizado
  const CustomCalendar = ({ 
    isOpen, 
    onClose, 
    selectedDate, 
    onDateChange, 
    containerRef,
    position 
  }: {
    isOpen: boolean
    onClose: () => void
    selectedDate: Date
    onDateChange: (date: Date) => void
    containerRef?: React.RefObject<HTMLDivElement>
    position?: { top: number; left: number; width: number }
  }) => {
    if (!isOpen) return null

    const daysInMonth = getDaysInMonth(selectedDate)
    const firstDay = getFirstDayOfMonth(selectedDate)
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ]
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

    const renderCalendarDays = () => {
      const days = []
      
      // Días del mes anterior
      const prevMonth = navigateMonth(selectedDate, 'prev')
      const daysInPrevMonth = getDaysInMonth(prevMonth)
      for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i
        const date = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), day)
        days.push(
          <button
            key={`prev-${day}`}
            className="w-10 h-10 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors duration-200"
            onClick={() => onDateChange(date)}
          >
            {day}
          </button>
        )
      }

      // Días del mes actual
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day)
        const isSelectedDay = isSelected(date)
        const isTodayDay = isToday(date)
        
        days.push(
          <button
            key={day}
            className={`w-10 h-10 rounded-lg transition-all duration-200 font-medium ${
              isSelectedDay
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg transform scale-105'
                : isTodayDay
                ? 'bg-blue-100 text-blue-700 border-2 border-blue-300'
                : 'text-slate-700 hover:bg-slate-100 hover:scale-105'
            }`}
            onClick={() => selectDate(date)}
          >
            {day}
          </button>
        )
      }

      // Días del mes siguiente
      const totalCells = 42 // 6 semanas x 7 días
      const remainingCells = totalCells - days.length
      const nextMonth = navigateMonth(selectedDate, 'next')
      for (let day = 1; day <= remainingCells; day++) {
        const date = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day)
        days.push(
          <button
            key={`next-${day}`}
            className="w-10 h-10 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors duration-200"
            onClick={() => onDateChange(date)}
          >
            {day}
          </button>
        )
      }

      return days
    }

    return (
      <div 
        ref={containerRef}
        className="fixed top-0 left-0 right-0 bottom-0"
        style={{ zIndex: 9999999 }}
      >
        <div 
          className="bg-white border-2 border-slate-200/60 rounded-2xl shadow-2xl overflow-hidden w-80 relative"
          style={position ? {
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: Math.max(position.width, 320),
            zIndex: 9999999
          } : {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '320px',
            zIndex: 9999999
          }}
        >
        <div className="p-6">
          {/* Header del calendario */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => onDateChange(navigateMonth(selectedDate, 'prev'))}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors duration-200"
            >
              <ChevronLeft className="h-5 w-5 text-slate-600" />
            </button>
            
            <h3 className="text-lg font-bold text-slate-800">
              {monthNames[selectedDate.getMonth()]} {selectedDate.getFullYear()}
            </h3>
            
            <button
              onClick={() => onDateChange(navigateMonth(selectedDate, 'next'))}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors duration-200"
            >
              <ChevronRight className="h-5 w-5 text-slate-600" />
            </button>
          </div>

          {/* Días de la semana */}
          <div className="grid grid-cols-7 gap-2 mb-4">
            {dayNames.map((day) => (
              <div key={day} className="text-center text-sm font-medium text-slate-500 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Días del calendario */}
          <div className="grid grid-cols-7 gap-2">
            {renderCalendarDays()}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-200">
            <button
              onClick={() => selectDate(new Date())}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-200"
            >
              Hoy
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors duration-200"
            >
              Cerrar
            </button>
          </div>
        </div>
        </div>
      </div>
    )
  }

  const exportData = () => {
    let csvContent = ''
    let filename = 'datos_usuarios.csv'

    // Función para escapar valores CSV
    const escapeCsvValue = (value: any) => {
      if (value === null || value === undefined) return ''
      const stringValue = String(value).trim()
      // Solo escapar si contiene punto y coma, comillas o saltos de línea
      if (stringValue.includes(';') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`
      }
      return stringValue
    }

    // Función para formatear fecha
    const formatDate = (dateString: string) => {
      try {
        return new Date(dateString).toLocaleDateString('es-ES')
      } catch {
        return dateString
      }
    }

    switch (selectedDataType) {
      case 'insulin':
        csvContent = [
          ['Usuario', 'Tipo de Dato', 'Tipo de Insulina', 'Dosis', 'Fecha y Hora'],
          ...insulinData.map(item => [
            escapeCsvValue(getUserEmail(item.username)),
            escapeCsvValue('Insulina'),
            escapeCsvValue(item.insulinType),
            escapeCsvValue(item.dose),
            escapeCsvValue(formatDate(item.date_time))
          ])
        ].map(row => row.join(';')).join('\n')
        filename = 'datos_insulina.csv'
        break
      case 'food':
        csvContent = [
          ['Usuario', 'Tipo de Dato', 'Tipo de Comida', 'Cantidad', 'Carbohidratos', 'Fecha y Hora'],
          ...foodData.map(item => [
            escapeCsvValue(getUserEmail(item.username)),
            escapeCsvValue('Comida'),
            escapeCsvValue(item.food_type),
            escapeCsvValue(item.quantity),
            escapeCsvValue(item.carbs),
            escapeCsvValue(formatDate(item.date_time))
          ])
        ].map(row => row.join(';')).join('\n')
        filename = 'datos_comidas.csv'
        break
      case 'exercise':
        csvContent = [
          ['Usuario', 'Tipo de Dato', 'Tipo de Ejercicio', 'Intensidad', 'Descripción', 'Fecha y Hora'],
          ...exerciseData.map(item => [
            escapeCsvValue(getUserEmail(item.username)),
            escapeCsvValue('Ejercicio'),
            escapeCsvValue(item.exercise_type),
            escapeCsvValue(item.intensity),
            escapeCsvValue(item.exercise_description),
            escapeCsvValue(formatDate(item.date_time))
          ])
        ].map(row => row.join(';')).join('\n')
        filename = 'datos_ejercicio.csv'
        break
      case 'period':
        csvContent = [
          ['Usuario', 'Tipo de Dato', 'Fecha de Inicio', 'Fecha de Fin', 'Intensidad', 'Síntomas', 'Notas'],
          ...periodData.map(item => [
            escapeCsvValue(getUserEmail(item.username)),
            escapeCsvValue('Período'),
            escapeCsvValue(formatDate(item.startDate)),
            escapeCsvValue(formatDate(item.endDate)),
            escapeCsvValue(item.intensity),
            escapeCsvValue(Array.isArray(item.symptoms) ? item.symptoms.join('; ') : item.symptoms),
            escapeCsvValue(item.notes)
          ])
        ].map(row => row.join(';')).join('\n')
        filename = 'datos_periodo.csv'
        break
      case 'mood':
        csvContent = [
          ['Usuario', 'Tipo de Dato', 'Valor de Estado de Ánimo', 'Fuera de Rutina', 'Descripción de Rutina', 'Emociones', 'Otra Emoción', 'Fecha y Hora'],
          ...moodData.map(item => [
            escapeCsvValue(getUserEmail(item.username)),
            escapeCsvValue('Estado de Ánimo'),
            escapeCsvValue(item.mood_value),
            escapeCsvValue(item.out_of_routine ? 'Sí' : 'No'),
            escapeCsvValue(item.routine_description),
            escapeCsvValue(Array.isArray(item.emotions) ? item.emotions.join('; ') : item.emotions),
            escapeCsvValue(item.other_emotion),
            escapeCsvValue(formatDate(item.date_time))
          ])
        ].map(row => row.join(';')).join('\n')
        filename = 'datos_estado_animo.csv'
        break
      default:
        // Exportar todos los datos en un formato unificado
        const allData = [
          // Insulina
          ...insulinData.map(item => ({
            usuario: getUserEmail(item.username),
            tipoDato: 'Insulina',
            valor1: item.insulinType,
            valor2: item.dose,
            valor3: '',
            valor4: '',
            valor5: '',
            fecha: formatDate(item.date_time)
          })),
          // Comidas
          ...foodData.map(item => ({
            usuario: getUserEmail(item.username),
            tipoDato: 'Comida',
            valor1: item.food_type,
            valor2: item.quantity,
            valor3: item.carbs,
            valor4: '',
            valor5: '',
            fecha: formatDate(item.date_time)
          })),
          // Ejercicio
          ...exerciseData.map(item => ({
            usuario: getUserEmail(item.username),
            tipoDato: 'Ejercicio',
            valor1: item.exercise_type,
            valor2: item.intensity,
            valor3: item.exercise_description,
            valor4: '',
            valor5: '',
            fecha: formatDate(item.date_time)
          })),
          // Períodos
          ...periodData.map(item => ({
            usuario: getUserEmail(item.username),
            tipoDato: 'Período',
            valor1: formatDate(item.startDate),
            valor2: formatDate(item.endDate),
            valor3: item.intensity,
            valor4: Array.isArray(item.symptoms) ? item.symptoms.join('; ') : item.symptoms,
            valor5: item.notes,
            fecha: formatDate(item.startDate)
          })),
          // Estado de ánimo
          ...moodData.map(item => ({
            usuario: getUserEmail(item.username),
            tipoDato: 'Estado de Ánimo',
            valor1: item.mood_value,
            valor2: item.out_of_routine ? 'Sí' : 'No',
            valor3: item.routine_description,
            valor4: Array.isArray(item.emotions) ? item.emotions.join('; ') : item.emotions,
            valor5: item.other_emotion,
            fecha: formatDate(item.date_time)
          }))
        ]

        csvContent = [
          ['Usuario', 'Tipo de Dato', 'Valor 1', 'Valor 2', 'Valor 3', 'Valor 4', 'Valor 5', 'Fecha'],
          ...allData.map(item => [
            escapeCsvValue(item.usuario),
            escapeCsvValue(item.tipoDato),
            escapeCsvValue(item.valor1),
            escapeCsvValue(item.valor2),
            escapeCsvValue(item.valor3),
            escapeCsvValue(item.valor4),
            escapeCsvValue(item.valor5),
            escapeCsvValue(item.fecha)
          ])
        ].map(row => row.join(';')).join('\n')
        filename = 'todos_los_datos.csv'
    }

    // Agregar BOM para que Excel reconozca UTF-8 y las columnas correctamente
    const BOM = '\uFEFF'
    const csvWithBOM = BOM + csvContent
    
    const blob = new Blob([csvWithBOM], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
  }

  // Estadísticas de los datos
  const stats = {
    totalInsulin: insulinData.length,
    totalFood: foodData.length,
    totalExercise: exerciseData.length,
    totalPeriods: periodData.length,
    totalMood: moodData.length,
    totalRecords: insulinData.length + foodData.length + exerciseData.length + periodData.length + moodData.length
  }

  // Agrupar datos por usuario para las tarjetas
  const userDataGroups = users.map(user => {
    const userInsulin = insulinData.filter(item => item.username === user.Username)
    const userFood = foodData.filter(item => item.username === user.Username)
    const userExercise = exerciseData.filter(item => item.username === user.Username)
    const userPeriods = periodData.filter(item => item.username === user.Username)
    const userMood = moodData.filter(item => item.username === user.Username)
    
    const userStats = {
      totalRecords: userInsulin.length + userFood.length + userExercise.length + userPeriods.length + userMood.length,
      insulinCount: userInsulin.length,
      foodCount: userFood.length,
      exerciseCount: userExercise.length,
      periodCount: userPeriods.length,
      moodCount: userMood.length,
      lastActivity: null as Date | null
    }

    // Encontrar la actividad más reciente
    const allDates = [
      ...userInsulin.map(d => new Date(d.date_time)),
      ...userFood.map(d => new Date(d.date_time)),
      ...userExercise.map(d => new Date(d.date_time)),
      ...userPeriods.map(d => new Date(d.startDate)),
      ...userMood.map(d => new Date(d.date_time))
    ]

    if (allDates.length > 0) {
      userStats.lastActivity = new Date(Math.max(...allDates.map(d => d.getTime())))
    }

    return { 
      user, 
      insulin: userInsulin, 
      food: userFood, 
      exercise: userExercise, 
      periods: userPeriods, 
      mood: userMood, 
      stats: userStats 
    }
  }).filter(group => group.stats.totalRecords > 0)

  const getDataTypeIcon = (type: string) => {
    switch (type) {
      case 'insulin': return <Pill className="h-4 w-4" />
      case 'food': return <Utensils className="h-4 w-4" />
      case 'exercise': return <Dumbbell className="h-4 w-4" />
      case 'period': return <CalendarDays className="h-4 w-4" />
      case 'mood': return <Smile className="h-4 w-4" />
      default: return <Activity className="h-4 w-4" />
    }
  }

  const getDataTypeColor = (type: string) => {
    switch (type) {
      case 'insulin': return 'text-blue-600 bg-blue-100'
      case 'food': return 'text-green-600 bg-green-100'
      case 'exercise': return 'text-orange-600 bg-orange-100'
      case 'period': return 'text-purple-600 bg-purple-100'
      case 'mood': return 'text-pink-600 bg-pink-100'
      default: return 'text-black bg-gray-100'
    }
  }

  const renderDataRecords = (data: any[], type: string, maxRecords: number = 2) => {
    const recordsToShow = showAllRecords.has(type) ? data : data.slice(0, maxRecords)
    
    const getTypeColors = (type: string) => {
      switch (type) {
        case 'insulin': return { bg: 'from-blue-50 to-blue-100', border: 'border-blue-200', text: 'text-blue-600', icon: 'from-blue-500 to-blue-600' }
        case 'food': return { bg: 'from-green-50 to-green-100', border: 'border-green-200', text: 'text-green-600', icon: 'from-green-500 to-green-600' }
        case 'exercise': return { bg: 'from-orange-50 to-orange-100', border: 'border-orange-200', text: 'text-orange-600', icon: 'from-orange-500 to-orange-600' }
        case 'period': return { bg: 'from-purple-50 to-purple-100', border: 'border-purple-200', text: 'text-purple-600', icon: 'from-purple-500 to-purple-600' }
        case 'mood': return { bg: 'from-pink-50 to-pink-100', border: 'border-pink-200', text: 'text-pink-600', icon: 'from-pink-500 to-pink-600' }
        default: return { bg: 'from-gray-50 to-gray-100', border: 'border-gray-200', text: 'text-gray-600', icon: 'from-gray-500 to-gray-600' }
      }
    }
    
    const colors = getTypeColors(type)
    
    return (
      <div className="space-y-4">
        {recordsToShow.map((item) => (
          <div key={item.id} className={`bg-gradient-to-br ${colors.bg} backdrop-blur-sm border ${colors.border} rounded-xl p-4`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`inline-flex items-center px-3 py-1 text-sm font-semibold rounded-full ${colors.text} bg-gradient-to-r ${colors.icon} text-white`}>
                {getDataTypeIcon(type)}
                <span className="ml-2">
                  {type === 'insulin' ? 'Insulina' : 
                   type === 'food' ? 'Comida' : 
                   type === 'exercise' ? 'Ejercicio' : 
                   type === 'period' ? 'Período' : 'Estado de Ánimo'}
                </span>
              </span>
              <span className="text-sm text-gray-600">
                {new Date(item.date_time || item.startDate).toLocaleDateString('es-ES')}
              </span>
            </div>
            <div className="text-sm text-gray-800">
              {type === 'insulin' && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.type}:</strong> <span className="text-gray-700">{item.insulinType}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.dose}:</strong> <span className="text-gray-700">{item.dose}</span></p>
                </>
              )}
              {type === 'food' && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.type}:</strong> <span className="text-gray-700">{item.food_type}</span></p>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.quantity}:</strong> <span className="text-gray-700">{item.quantity}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.carbs}:</strong> <span className="text-gray-700">{item.carbs}</span></p>
                </>
              )}
              {type === 'exercise' && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.type}:</strong> <span className="text-gray-700">{item.exercise_type}</span></p>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.intensity}:</strong> <span className="text-gray-700">{item.intensity}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.description}:</strong> <span className="text-gray-700">{item.exercise_description}</span></p>
                </>
              )}
              {type === 'period' && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.intensity}:</strong> <span className="text-gray-700">{item.intensity}</span></p>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.symptoms}:</strong> <span className="text-gray-700">{Array.isArray(item.symptoms) ? item.symptoms.join(', ') : item.symptoms}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.notes}:</strong> <span className="text-gray-700">{item.notes}</span></p>
                </>
              )}
              {type === 'mood' && (
                <>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.value}:</strong> <span className="text-gray-700">{item.mood_value}/10</span></p>
                  <p className="mb-1"><strong className="text-gray-900">{t.dashboard.outOfRoutine}:</strong> <span className="text-gray-700">{item.out_of_routine ? t.dashboard.yes : t.dashboard.no}</span></p>
                  <p><strong className="text-gray-900">{t.dashboard.emotions}:</strong> <span className="text-gray-700">{Array.isArray(item.emotions) ? item.emotions.join(', ') : item.emotions}</span></p>
                </>
              )}
            </div>
          </div>
        ))}
        
        {data.length > maxRecords && (
          <button
            onClick={() => toggleShowAllRecords(type)}
            className="w-full text-center text-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 border border-blue-200 rounded-xl hover:from-blue-400 hover:to-blue-500 transition-all duration-300 transform hover:scale-105 flex items-center justify-center"
          >
            {showAllRecords.has(type) ? (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                {t.dashboard.showLess}
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 mr-2" />
                {t.dashboard.viewAll} {data.length} {t.dashboard.records2}
              </>
            )}
          </button>
        )}
      </div>
    )
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
        
        <Navigation title={isIndividualUser ? t.dashboard.healthData : t.dashboard.healthData} showBackButton={true} />
        
        {/* Selector de idioma */}
        <div className="absolute top-6 right-6 z-20 hidden xl:block">
          <LanguageSelector />
        </div>
        
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 lg:py-8 xl:py-12 relative z-10">
          {/* Header con estadísticas */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-10 mb-6 sm:mb-12 overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 sm:mb-8 space-y-4 lg:space-y-0">
              <div className="flex flex-col sm:flex-row sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
                <div className="flex items-center space-x-4 sm:space-x-6">
                  <div className="p-3 sm:p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl sm:rounded-2xl shadow-lg">
                    <Database className="h-8 w-8 sm:h-12 sm:w-12 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-gray-900">
                      {isIndividualUser ? t.dashboard.healthData : t.dashboard.healthData}
                    </h2>
                    <p className="text-gray-600 text-sm sm:text-base lg:text-xl font-light">{t.dashboard.healthDataDescription}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="flex items-center space-x-3 bg-white/80 backdrop-blur-sm border border-gray-200/50 px-4 sm:px-6 py-2 sm:py-3 rounded-xl shadow-lg">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm sm:text-base text-gray-800 font-semibold">
                    {stats.totalRecords} registros totales
                  </span>
                </div>
                <button
                  onClick={exportData}
                  className="flex items-center space-x-2 sm:space-x-3 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 shadow-lg hover:shadow-xl"
                >
                  <Download className="h-4 w-4 sm:h-5 sm:w-5" />
                  <span className="font-semibold text-sm sm:text-lg">{t.dashboard.exportCSV}</span>
                </button>
              </div>
            </div>

            {/* Barra de búsqueda */}
            <div className="relative z-10">
              <div className="relative max-w-md">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 sm:h-6 sm:w-6 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar en datos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 sm:pl-14 pr-4 py-3 sm:py-4 bg-white/50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 hover:bg-white/70 text-sm sm:text-base"
                />
              </div>
            </div>
          </div>

          {/* Estadísticas generales */}
          <div className="mb-8 sm:mb-12">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 hover:shadow-2xl hover:shadow-blue-500/10 transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-2 sm:p-3 lg:p-4 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl sm:rounded-2xl shadow-lg">
                      <Pill className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                    </div>
                  </div>
                  <div className="ml-3 sm:ml-4 lg:ml-6">
                    <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-gray-900">{t.dashboard.insulin}</h3>
                    <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-blue-600">{stats.totalInsulin}</p>
                  </div>
                </div>
              </div>

              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 hover:shadow-2xl hover:shadow-green-500/10 transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-2 sm:p-3 lg:p-4 bg-gradient-to-br from-green-600 to-green-700 rounded-xl sm:rounded-2xl shadow-lg">
                      <Utensils className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                    </div>
                  </div>
                  <div className="ml-3 sm:ml-4 lg:ml-6">
                    <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-gray-900">{t.dashboard.food}</h3>
                    <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-green-600">{stats.totalFood}</p>
                  </div>
                </div>
              </div>

              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 hover:shadow-2xl hover:shadow-orange-500/10 transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-2 sm:p-3 lg:p-4 bg-gradient-to-br from-orange-600 to-orange-700 rounded-xl sm:rounded-2xl shadow-lg">
                      <Dumbbell className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                    </div>
                  </div>
                  <div className="ml-3 sm:ml-4 lg:ml-6">
                    <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-gray-900">{t.dashboard.exercise}</h3>
                    <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-orange-600">{stats.totalExercise}</p>
                  </div>
                </div>
              </div>

              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 hover:shadow-2xl hover:shadow-purple-500/10 transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-2 sm:p-3 lg:p-4 bg-gradient-to-br from-purple-600 to-purple-700 rounded-xl sm:rounded-2xl shadow-lg">
                      <CalendarDays className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                    </div>
                  </div>
                  <div className="ml-3 sm:ml-4 lg:ml-6">
                    <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-gray-900">{t.dashboard.periods}</h3>
                    <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-purple-600">{stats.totalPeriods}</p>
                  </div>
                </div>
              </div>

              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 hover:shadow-2xl hover:shadow-pink-500/10 transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-2 sm:p-3 lg:p-4 bg-gradient-to-br from-pink-600 to-pink-700 rounded-xl sm:rounded-2xl shadow-lg">
                      <Smile className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                    </div>
                  </div>
                  <div className="ml-3 sm:ml-4 lg:ml-6">
                    <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-gray-900">{t.dashboard.mood}</h3>
                    <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-pink-600">{stats.totalMood}</p>
                  </div>
                </div>
              </div>

              <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 hover:shadow-2xl hover:shadow-indigo-500/10 transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-2 sm:p-3 lg:p-4 bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-xl sm:rounded-2xl shadow-lg">
                      <Activity className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                    </div>
                  </div>
                  <div className="ml-3 sm:ml-4 lg:ml-6">
                    <h3 className="text-sm sm:text-base lg:text-xl font-semibold text-gray-900">{t.dashboard.total}</h3>
                    <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-indigo-600">{stats.totalRecords}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Filtros mejorados */}
          <div className="relative bg-white/90 backdrop-blur-xl border border-gray-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-10 mb-8 sm:mb-12 overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5"></div>
            
            <div className="relative z-10">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 space-y-3 sm:space-y-0">
                <div className="flex items-center">
                  <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg mr-3">
                    <Filter className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-blue-900">{t.dashboard.dataFilters}</h2>
                </div>
                <button
                  onClick={clearFilters}
                  className="px-3 sm:px-4 py-2 text-xs sm:text-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-400 hover:to-blue-500 transition-all duration-300 transform hover:scale-105 flex items-center"
                >
                  <span className="mr-1 sm:mr-2">🗑️</span>
                  {t.dashboard.clearFilters}
                </button>
              </div>
              
              <div className={`grid grid-cols-1 gap-4 sm:gap-6 ${isIndividualUser ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
                {!isIndividualUser && (
                  <div>
                    <label className="block text-xs sm:text-sm font-bold text-blue-900 mb-2 sm:mb-3 flex items-center">
                      <UserIcon className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      {t.dashboard.user}
                    </label>
                    <select
                      value={selectedUser}
                      onChange={(e) => setSelectedUser(e.target.value)}
                      className="w-full bg-white border-2 border-blue-200 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-blue-900 shadow-lg hover:border-blue-300 transition-all duration-300 cursor-pointer appearance-none bg-gradient-to-r from-blue-50 to-indigo-50 text-sm sm:text-base"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                        backgroundPosition: 'right 8px center',
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '12px'
                      }}
                    >
                      <option value="all" className="bg-white text-blue-900 py-2">{t.dashboard.allUsers}</option>
                      {users.map(user => (
                        <option key={user.UserID} value={user.Username} className="bg-white text-blue-900">
                          {user.Username}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-blue-900 mb-2 sm:mb-3 flex items-center">
                    <Activity className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    {t.dashboard.dataType}
                  </label>
                  <select
                    value={selectedDataType}
                    onChange={(e) => setSelectedDataType(e.target.value)}
                    className="w-full bg-white border-2 border-blue-200 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-blue-900 shadow-lg hover:border-blue-300 transition-all duration-300 cursor-pointer appearance-none bg-gradient-to-r from-blue-50 to-indigo-50 text-sm sm:text-base"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 8px center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '12px'
                    }}
                  >
                    <option value="all" className="bg-white text-blue-900 py-2">{t.dashboard.allTypes}</option>
                    <option value="insulin" className="bg-white text-blue-900">Insulina</option>
                    <option value="food" className="bg-white text-blue-900">Comidas</option>
                    <option value="exercise" className="bg-white text-blue-900">Ejercicio</option>
                    <option value="period" className="bg-white text-blue-900">Períodos</option>
                    <option value="mood" className="bg-white text-blue-900">Estado de Ánimo</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-blue-900 mb-2 sm:mb-3 flex items-center">
                    <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    {t.dashboard.timeRange}
                  </label>
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                    className="w-full bg-white border-2 border-blue-200 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-blue-900 shadow-lg hover:border-blue-300 transition-all duration-300 cursor-pointer appearance-none bg-gradient-to-r from-blue-50 to-indigo-50 text-sm sm:text-base"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 8px center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '12px'
                    }}
                  >
                    <option value="all" className="bg-white text-blue-900 py-2">{t.dashboard.allTime}</option>
                    <option value="1d" className="bg-white text-blue-900">Último día</option>
                    <option value="7d" className="bg-white text-blue-900">Últimos 7 días</option>
                    <option value="30d" className="bg-white text-blue-900">Últimos 30 días</option>
                    <option value="90d" className="bg-white text-blue-900">Últimos 90 días</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-blue-900 mb-2 sm:mb-3 flex items-center">
                    <Calendar className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    {t.dashboard.specificDate}
                  </label>
                  <button
                    ref={datePickerRef}
                    onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                    className="w-full bg-white border border-blue-200 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-blue-900 text-left hover:bg-blue-50 transition-all duration-300 flex items-center justify-between text-sm sm:text-base"
                  >
                    <span className={dateFilter ? 'text-blue-900' : 'text-gray-500'}>
                      {dateFilter ? formatDisplayDate(new Date(dateFilter)) : t.dashboard.selectDate}
                    </span>
                    <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                  </button>
                  
                  <Portal>
                    <CustomCalendar
                      isOpen={isDatePickerOpen}
                      onClose={() => setIsDatePickerOpen(false)}
                      selectedDate={datePicker}
                      onDateChange={handleDateChange}
                      containerRef={datePickerPortalRef}
                      position={datePickerPosition || undefined}
                    />
                  </Portal>
                </div>
              </div>
            </div>
          </div>

          {/* Contenido principal */}
          {loading ? (
            <div className="relative bg-white backdrop-blur-xl border border-blue-200/50 rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-12 text-center shadow-lg">
              <div className="flex flex-col items-center justify-center space-y-4 sm:space-y-6">
                <div className="animate-spin rounded-full h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 border-b-2 border-blue-500"></div>
                <div className="w-full max-w-sm sm:max-w-md">
                  <div className="flex justify-between text-xs sm:text-sm text-blue-600 mb-2">
                    <span>{t.dashboard.loadingData}</span>
                    <span>{loadingProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${loadingProgress}%` }}
                    ></div>
                  </div>
                </div>
                <p className="text-blue-700 text-xs sm:text-sm">
                  {loadingProgress < 40 ? t.dashboard.connectingServer :
                   loadingProgress < 60 ? t.dashboard.decryptingData :
                   loadingProgress < 80 ? t.dashboard.processingInfo :
                   t.dashboard.finalizing}
                </p>
              </div>
            </div>
          ) : (
            /* Vista de tarjetas por usuario */
            <div className="space-y-4 sm:space-y-6 lg:space-y-8">
              {userDataGroups.length > 0 ? (
                userDataGroups.map((group) => (
                  <div key={group.user.UserID} className="relative bg-white backdrop-blur-xl border border-blue-200/50 rounded-2xl sm:rounded-3xl overflow-hidden shadow-lg">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-blue-100/50"></div>
                    
                    <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 border-b border-blue-200">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-3 sm:space-y-0">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg sm:text-xl font-bold text-blue-900 mb-1 truncate">
                            {group.user.Username}
                          </h3>
                          <p className="text-sm sm:text-base text-blue-700">
                            {group.stats.totalRecords} {t.dashboard.totalRecords}
                          </p>
                        </div>
                        <div className="flex items-center space-x-3 sm:space-x-6 w-full sm:w-auto justify-between sm:justify-end">
                          <div className="text-left sm:text-right">
                            <p className="text-xs sm:text-sm text-blue-600">{t.dashboard.lastActivity}</p>
                            <p className="text-xs sm:text-sm font-medium text-blue-900">
                              {group.stats.lastActivity ? 
                                new Date(group.stats.lastActivity).toLocaleDateString('es-ES') : 
                                'N/A'
                              }
                            </p>
                          </div>
                          <button
                            onClick={() => toggleUserExpansion(group.user.UserID)}
                            className="p-2 sm:p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg sm:rounded-xl hover:from-blue-400 hover:to-blue-500 transition-all duration-300 transform hover:scale-105 flex-shrink-0"
                          >
                            {expandedUsers.has(group.user.UserID) ? (
                              <ChevronUp className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                            ) : (
                              <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {expandedUsers.has(group.user.UserID) && (
                      <div className="relative z-10 p-4 sm:p-6 lg:p-8">
                        {/* Resumen por tipo de dato */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 lg:gap-6 mb-6 sm:mb-8">
                          <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-blue-50 to-blue-100 backdrop-blur-sm border border-blue-200 rounded-lg sm:rounded-xl">
                            <div className="p-1.5 sm:p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                              <Pill className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                            </div>
                            <p className="text-sm sm:text-base lg:text-lg font-bold text-blue-600">{group.stats.insulinCount}</p>
                            <p className="text-xs sm:text-sm text-blue-700">{t.dashboard.insulin}</p>
                          </div>
                          <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-green-50 to-green-100 backdrop-blur-sm border border-green-200 rounded-lg sm:rounded-xl">
                            <div className="p-1.5 sm:p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                              <Utensils className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                            </div>
                            <p className="text-sm sm:text-base lg:text-lg font-bold text-green-600">{group.stats.foodCount}</p>
                            <p className="text-xs sm:text-sm text-green-700">{t.dashboard.meals}</p>
                          </div>
                          <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-orange-50 to-orange-100 backdrop-blur-sm border border-orange-200 rounded-lg sm:rounded-xl">
                            <div className="p-1.5 sm:p-2 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                              <Dumbbell className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                            </div>
                            <p className="text-sm sm:text-base lg:text-lg font-bold text-orange-600">{group.stats.exerciseCount}</p>
                            <p className="text-xs sm:text-sm text-orange-700">{t.dashboard.exercise}</p>
                          </div>
                          <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-purple-50 to-purple-100 backdrop-blur-sm border border-purple-200 rounded-lg sm:rounded-xl">
                            <div className="p-1.5 sm:p-2 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                              <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                            </div>
                            <p className="text-sm sm:text-base lg:text-lg font-bold text-purple-600">{group.stats.periodCount}</p>
                            <p className="text-xs sm:text-sm text-purple-700">{t.dashboard.periods}</p>
                          </div>
                          <div className="text-center p-3 sm:p-4 bg-gradient-to-br from-pink-50 to-pink-100 backdrop-blur-sm border border-pink-200 rounded-lg sm:rounded-xl">
                            <div className="p-1.5 sm:p-2 bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg w-fit mx-auto mb-2 sm:mb-3">
                              <Smile className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" />
                            </div>
                            <p className="text-sm sm:text-base lg:text-lg font-bold text-pink-600">{group.stats.moodCount}</p>
                            <p className="text-xs sm:text-sm text-pink-700">{t.dashboard.mood}</p>
                          </div>
                        </div>

                        {/* Datos detallados por tipo */}
                        <div className="space-y-6 sm:space-y-8">
                          {/* Insulina */}
                          {group.insulin.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-blue-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg mr-2 sm:mr-3">
                                  <Pill className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.insulinData} ({group.insulin.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.insulin, 'insulin')}
                            </div>
                          )}

                          {/* Comidas */}
                          {group.food.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-green-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg mr-2 sm:mr-3">
                                  <Utensils className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.food} ({group.food.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.food, 'food')}
                            </div>
                          )}

                          {/* Ejercicio */}
                          {group.exercise.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-orange-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg mr-2 sm:mr-3">
                                  <Dumbbell className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.exercise} ({group.exercise.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.exercise, 'exercise')}
                            </div>
                          )}

                          {/* Períodos */}
                          {group.periods.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-purple-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg mr-2 sm:mr-3">
                                  <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.periods} ({group.periods.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.periods, 'period')}
                            </div>
                          )}

                          {/* Estado de ánimo */}
                          {group.mood.length > 0 && (
                            <div>
                              <h4 className="text-base sm:text-lg font-bold text-pink-900 mb-3 sm:mb-4 flex items-center">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg mr-2 sm:mr-3">
                                  <Smile className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                                </div>
                                {t.dashboard.mood} ({group.mood.length} {t.dashboard.records})
                              </h4>
                              {renderDataRecords(group.mood, 'mood')}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="relative bg-gradient-to-r from-slate-800/50 to-slate-900/50 backdrop-blur-xl border border-white/20 rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-12 text-center">
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-800/20 to-slate-900/20"></div>
                  <div className="relative z-10">
                    <div className="p-3 sm:p-4 bg-gradient-to-br from-green-500/20 to-emerald-600/20 backdrop-blur-sm border border-green-400/30 rounded-xl sm:rounded-2xl w-fit mx-auto mb-4 sm:mb-6">
                      <Activity className="h-12 w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16 text-green-400" />
                    </div>
                    <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-2 sm:mb-3">{t.dashboard.noDataFound}</h3>
                    <p className="text-white/70 text-sm sm:text-base lg:text-lg">{t.dashboard.noRecordsForFilters}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}