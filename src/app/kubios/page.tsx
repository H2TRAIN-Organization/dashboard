'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Heart, Users, Calendar, Filter, Download, RefreshCw, TrendingUp, Activity, ChevronDown, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import Navigation from '@/components/Navigation'
import HRVCharts from '@/components/HRVCharts'
import { useLanguage } from '@/contexts/LanguageContext'
import LanguageSelector from '@/components/LanguageSelector'

interface KubiosUser {
  user_id: string
  name: string
  email: string
  measurement_count: number
}

interface HRVResult {
  result_id: string
  measure_id: string
  measured_timestamp: string
  daily_result: string
  result: {
    readiness: number
    recovery: number
    mean_hr_bpm: number
    rmssd_ms: number
    pns_index: number
    sns_index: number
    physiological_age: number
    respiratory_rate: number
    stress_index: number
    artefact_level: string
    effective_prc: number
    freq_domain: {
      HF_power: number
      LF_power: number
      VLF_power: number
      tot_power: number
    }
  }
  user_happiness?: number
}

export default function KubiosPage() {
  // Verificación de seguridad para el contexto de idioma
  let t: any
  try {
    const languageContext = useLanguage()
    t = languageContext?.t
  } catch (error) {
    console.error('Error accessing language context:', error)
    t = null
  }
  
  // Verificación de seguridad para evitar errores de runtime
  if (!t || typeof t !== 'object' || !t.kubios) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Cargando traducciones...</p>
        </div>
      </div>
    )
  }
  const [users, setUsers] = useState<KubiosUser[]>([])
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [hrvResults, setHrvResults] = useState<HRVResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [dateFilter, setDateFilter] = useState<{from: string, to: string}>({
    from: '',
    to: ''
  })
  const [showCharts, setShowCharts] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isFromDateOpen, setIsFromDateOpen] = useState(false)
  const [isToDateOpen, setIsToDateOpen] = useState(false)
  const [fromDatePicker, setFromDatePicker] = useState(new Date())
  const [toDatePicker, setToDatePicker] = useState(new Date())
  const dropdownRef = useRef<HTMLDivElement>(null)
  const userDropdownButtonRef = useRef<HTMLButtonElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const userDropdownPortalRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const fromDateRef = useRef<HTMLButtonElement>(null)
  const toDateRef = useRef<HTMLButtonElement>(null)
  const fromDatePickerRef = useRef<HTMLDivElement>(null)
  const toDatePickerRef = useRef<HTMLDivElement>(null)
  const fromCalendarPortalRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const toCalendarPortalRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const [fromDatePosition, setFromDatePosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const [toDatePosition, setToDatePosition] = useState<{ top: number; left: number; width: number } | null>(null)

  // Cargar usuarios del equipo
  useEffect(() => {
    loadTeamUsers()
  }, [])

  // Cerrar dropdowns al hacer click fuera y recalcular posición al hacer scroll/resize
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      // Dropdown de usuarios (portal) - no cerrar si el click es dentro del dropdown
      if (
        isDropdownOpen &&
        (userDropdownPortalRef.current?.contains(target) || dropdownRef.current?.contains(target))
      ) {
        return
      }
      // Solo cerrar si es un click real, no un scroll
      if (isDropdownOpen && event.type === 'mousedown') {
        setIsDropdownOpen(false)
      }

      // Calendarios (portal)
      if (isFromDateOpen && fromCalendarPortalRef.current?.contains(target)) return
      if (isToDateOpen && toCalendarPortalRef.current?.contains(target)) return
      if (isFromDateOpen) setIsFromDateOpen(false)
      if (isToDateOpen) setIsToDateOpen(false)
    }

    const updateDropdownPosition = () => {
      if (!isDropdownOpen) return
      const btn = userDropdownButtonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setDropdownPosition({ top: rect.bottom + 8, left: rect.left, width: rect.width })
    }

    const updateDatePickerPositions = () => {
      if (fromDateRef.current && isFromDateOpen) {
        const rect = fromDateRef.current.getBoundingClientRect()
        setFromDatePosition({
          top: rect.bottom + 8,
          left: rect.left,
          width: rect.width
        })
      }
      if (toDateRef.current && isToDateOpen) {
        const rect = toDateRef.current.getBoundingClientRect()
        setToDatePosition({
          top: rect.bottom + 8,
          left: rect.left,
          width: rect.width
        })
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    
    // Manejar scroll dentro del dropdown para evitar que se cierre
    const handleDropdownScroll = (event: Event) => {
      const target = event.target as Node
      if (userDropdownPortalRef.current?.contains(target)) {
        // Si el scroll es dentro del dropdown, no hacer nada
        return
      }
      // Solo actualizar posición si el scroll es fuera del dropdown
      updateDropdownPosition()
    }
    
    window.addEventListener('scroll', handleDropdownScroll, true)
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDatePickerPositions, true)
    window.addEventListener('resize', updateDatePickerPositions)

    updateDropdownPosition()
    updateDatePickerPositions()

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleDropdownScroll, true)
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDatePickerPositions, true)
      window.removeEventListener('resize', updateDatePickerPositions)
    }
  }, [isDropdownOpen, isFromDateOpen, isToDateOpen])

  const loadTeamUsers = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/kubios/team-users')
      if (!response.ok) throw new Error('Error al cargar usuarios')
      
      const data = await response.json()
      setUsers(data.users || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const loadHRVResults = async (userId: string, loadAll: boolean = false) => {
    try {
      setLoading(true)
      setError('')
      
      const params = new URLSearchParams({ user_id: userId })
      
      // Solo aplicar filtros de fecha si están explícitamente configurados y no es loadAll
      if (!loadAll && dateFilter.from && dateFilter.to) {
        params.append('from_date', dateFilter.from)
        params.append('to_date', dateFilter.to)
      }
      
      const response = await fetch(`/api/kubios/hrv-results?${params}`)
      
      if (!response.ok) throw new Error('Error al cargar resultados HRV')
      
      const data = await response.json()
      setHrvResults(data.results || [])
      
      // Mostrar mensaje si se usó fallback
      if (data.source === 'mock_data') {
        setError('⚠️ Usando datos de ejemplo - Servicio de Kubios no disponible')
      }
      
      // Si no hay resultados y hay filtros de fecha, mostrar mensaje informativo
      if ((data.results || []).length === 0 && dateFilter.from && dateFilter.to) {
        setError(`No se encontraron resultados HRV para este usuario en el rango de fechas seleccionado (${dateFilter.from} - ${dateFilter.to})`)
      } else if ((data.results || []).length === 0) {
        setError('No se encontraron resultados HRV para este usuario')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const loadAllUsersHRVResults = async () => {
    try {
      setLoading(true)
      setError('')
      
      // Verificar que los usuarios estén cargados
      if (!users || users.length === 0) {
        console.log('⚠️ No hay usuarios disponibles para cargar resultados')
        setError('No hay usuarios disponibles')
        setLoading(false)
        return
      }
      
      console.log(`📊 Cargando resultados para ${users.length} usuarios`)
      
      // Hacer llamadas paralelas por cada usuario para mayor eficiencia
      const userPromises = users.map(async (user) => {
        try {
          console.log(`🔍 Procesando usuario: ${user.name} (ID: ${user.user_id})`)
          
          if (!user.user_id) {
            console.warn(`⚠️ Usuario ${user.name} no tiene user_id`)
            return []
          }
          
          const params = new URLSearchParams({ user_id: user.user_id })
          
          const response = await fetch(`/api/kubios/hrv-results?${params}`)
          
          if (response.ok) {
            const data = await response.json()
            // Agregar información del usuario a cada resultado
            const userResults = (data.results || []).map((result: any) => ({
              ...result,
              user_id: user.user_id,
              user_name: user.name
            }))
            return userResults
          } else {
            console.warn(`Error en respuesta para usuario ${user.name}: ${response.status}`)
            return []
          }
        } catch (userError) {
          console.warn(`Error cargando datos para usuario ${user.name}:`, userError)
          return []
        }
      })
      
      // Esperar a que todas las llamadas terminen
      const userResultsArrays = await Promise.all(userPromises)
      
      // Combinar todos los resultados
      const allResults = userResultsArrays.flat()
      
      // Ordenar todos los resultados por fecha
      allResults.sort((a, b) => new Date(a.measured_timestamp).getTime() - new Date(b.measured_timestamp).getTime())
      
      setHrvResults(allResults)
      setSelectedUser('all') // Marcar que se están mostrando todos los usuarios
      
      if (allResults.length === 0) {
        setError('No se encontraron datos para ningún usuario')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const handleUserSelect = (userId: string) => {
    setSelectedUser(userId)
    setIsDropdownOpen(false)
    if (userId) {
      loadHRVResults(userId)
    } else {
      setHrvResults([])
    }
  }

  const getReadinessColor = (readiness: number) => {
    if (readiness >= 80) return 'text-green-600 bg-green-100'
    if (readiness >= 60) return 'text-blue-600 bg-blue-100'
    if (readiness >= 40) return 'text-yellow-600 bg-yellow-100'
    return 'text-red-600 bg-red-100'
  }

  const getReadinessColorDark = (readiness: number) => {
    if (readiness >= 80) return 'text-white bg-gradient-to-r from-green-500 to-emerald-500'
    if (readiness >= 60) return 'text-white bg-gradient-to-r from-blue-500 to-cyan-500'
    if (readiness >= 40) return 'text-white bg-gradient-to-r from-yellow-500 to-orange-500'
    return 'text-white bg-gradient-to-r from-red-500 to-rose-500'
  }

  const getReadinessLevel = (readiness: number) => {
    if (readiness >= 80) return t.kubios.readinessLevels.high
    if (readiness >= 60) return t.kubios.readinessLevels.normal
    if (readiness >= 40) return t.kubios.readinessLevels.low
    return t.kubios.readinessLevels.veryLow
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
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

  const handleFromDateChange = (date: Date) => {
    // Crear una nueva fecha en zona horaria local para evitar problemas de UTC
    const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    setFromDatePicker(localDate)
    setDateFilter(prev => ({ ...prev, from: formatDateForInput(localDate) }))
  }

  const handleToDateChange = (date: Date) => {
    // Crear una nueva fecha en zona horaria local para evitar problemas de UTC
    const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    setToDatePicker(localDate)
    setDateFilter(prev => ({ ...prev, to: formatDateForInput(localDate) }))
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

  const selectDate = (date: Date, type: 'from' | 'to') => {
    const dateString = formatDateForInput(date)
    if (type === 'from') {
      setDateFilter(prev => ({ ...prev, from: dateString }))
      setIsFromDateOpen(false)
    } else {
      setDateFilter(prev => ({ ...prev, to: dateString }))
      setIsToDateOpen(false)
    }
  }

  const isToday = (date: Date) => {
    const today = new Date()
    return date.toDateString() === today.toDateString()
  }

  const isSelected = (date: Date, type: 'from' | 'to') => {
    const dateString = formatDateForInput(date)
    if (type === 'from') {
      return dateFilter.from === dateString
    } else {
      return dateFilter.to === dateString
    }
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
    type, 
    color, 
    containerRef,
    position 
  }: {
    isOpen: boolean
    onClose: () => void
    selectedDate: Date
    onDateChange: (date: Date) => void
    type: 'from' | 'to'
    color: string
    containerRef?: React.RefObject<HTMLDivElement>
    position?: { top: number; left: number; width: number }
  }) => {
    if (!isOpen) return null

    const daysInMonth = getDaysInMonth(selectedDate)
    const firstDay = getFirstDayOfMonth(selectedDate)
    const monthNames = t.datepicker.months
    const dayNames = t.datepicker.days

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
        const isSelectedDay = isSelected(date, type)
        const isTodayDay = isToday(date)
        
        days.push(
          <button
            key={day}
            className={`w-10 h-10 rounded-lg transition-all duration-200 font-medium ${
              isSelectedDay
                ? `bg-gradient-to-r ${color} text-white shadow-lg transform scale-105`
                : isTodayDay
                ? 'bg-blue-100 text-blue-700 border-2 border-blue-300'
                : 'text-slate-700 hover:bg-slate-100 hover:scale-105'
            }`}
            onClick={() => selectDate(date, type)}
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
          className="bg-white border-2 border-slate-200/60 rounded-2xl shadow-2xl overflow-hidden max-w-sm w-full relative"
          style={position ? {
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: position.width,
            zIndex: 9999999
          } : {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
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
            {dayNames.map((day: string) => (
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
              onClick={() => selectDate(new Date(), type)}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-200"
            >
              {t.datepicker.today}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors duration-200"
            >
              {t.datepicker.close}
            </button>
          </div>
        </div>
        </div>
      </div>
    )
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 relative overflow-hidden">
        {/* Estilos personalizados para el datepicker */}
        <style jsx global>{`
          input[type="date"]::-webkit-calendar-picker-indicator {
            opacity: 0;
            position: absolute;
            right: 0;
            top: 0;
            width: 100%;
            height: 100%;
            cursor: pointer;
          }
          
          input[type="date"]::-webkit-datetime-edit-text {
            color: #475569;
            font-weight: 500;
          }
          
          input[type="date"]::-webkit-datetime-edit-month-field,
          input[type="date"]::-webkit-datetime-edit-day-field,
          input[type="date"]::-webkit-datetime-edit-year-field {
            color: #475569;
            font-weight: 500;
          }
          
          input[type="date"]::-webkit-datetime-edit-month-field:focus,
          input[type="date"]::-webkit-datetime-edit-day-field:focus,
          input[type="date"]::-webkit-datetime-edit-year-field:focus {
            background-color: rgba(59, 130, 246, 0.1);
            border-radius: 4px;
            outline: none;
          }
          
          /* Mejorar la apariencia del calendario popup */
          input[type="date"]::-webkit-datetime-edit {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          
          input[type="date"]::-webkit-datetime-edit-fields-wrapper {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          
          /* Estilos para el popup del calendario */
          input[type="date"]::-webkit-calendar-picker-indicator:focus {
            outline: none;
          }
          
          /* Personalizar el calendario popup */
          input[type="date"]::-webkit-calendar-picker-indicator:active {
            background-color: rgba(59, 130, 246, 0.2);
            border-radius: 8px;
          }
          
          /* Mejorar el estilo del calendario nativo */
          input[type="date"]::-webkit-calendar-picker-indicator:hover {
            background-color: rgba(59, 130, 246, 0.1);
            border-radius: 4px;
          }
          
          /* Estilos para el calendario popup del navegador */
          input[type="date"]::-webkit-calendar-picker-indicator {
            background: transparent;
            border: none;
            cursor: pointer;
          }
          
          /* Mejorar la apariencia del texto del input */
          input[type="date"]::-webkit-datetime-edit-text {
            color: #475569;
            font-weight: 500;
            font-size: 16px;
          }
          
          input[type="date"]::-webkit-datetime-edit-month-field,
          input[type="date"]::-webkit-datetime-edit-day-field,
          input[type="date"]::-webkit-datetime-edit-year-field {
            color: #475569;
            font-weight: 500;
            font-size: 16px;
            padding: 2px 4px;
            border-radius: 4px;
            transition: background-color 0.2s ease;
          }
          
          input[type="date"]::-webkit-datetime-edit-month-field:hover,
          input[type="date"]::-webkit-datetime-edit-day-field:hover,
          input[type="date"]::-webkit-datetime-edit-year-field:hover {
            background-color: rgba(59, 130, 246, 0.05);
          }
        `}</style>
        {/* Elementos decorativos de fondo */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-1000"></div>
          <div className="absolute top-40 left-1/2 w-80 h-80 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-500"></div>
        </div>
        
        <Navigation title={t.kubios.title} showBackButton={true} />
        
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
                    <Heart className="h-8 w-8 sm:h-12 sm:w-12 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-gray-900">
                      {t.kubios.hrvResults}
                    </h2>
                    <p className="text-gray-600 text-sm sm:text-base lg:text-xl font-light">{t.kubios.subtitle}</p>
                  </div>
                </div>
              </div>
              {/* Botones en dos filas - 2 por fila (también en móvil) */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {/* Primera fila: Show Charts */}
                <button
                  onClick={() => setShowCharts(!showCharts)}
                  disabled={!selectedUser || hrvResults.length === 0}
                  className="group flex items-center justify-center space-x-1 sm:space-x-2 bg-white/80 border border-gray-200 px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 rounded-xl text-gray-700 hover:border-blue-300 hover:bg-blue-50 transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none shadow-lg hover:shadow-xl"
                >
                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 group-hover:scale-110 transition-transform" />
                  <span className="font-semibold text-xs sm:text-sm lg:text-lg">{showCharts ? t.kubios.hideCharts : t.kubios.showCharts}</span>
                </button>
                
                {/* Primera fila: Refresh */}
                <button
                  onClick={() => selectedUser && loadHRVResults(selectedUser)}
                  disabled={loading}
                  className="group flex items-center justify-center space-x-1 sm:space-x-2 bg-white/80 border border-gray-200 px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 rounded-xl text-gray-700 hover:border-green-300 hover:bg-green-50 transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none shadow-lg hover:shadow-xl"
                >
                  <RefreshCw className={`h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 ${loading ? 'animate-spin' : 'group-hover:rotate-180'} transition-transform duration-500`} />
                  <span className="font-semibold text-xs sm:text-sm lg:text-lg">{t.common.refresh}</span>
                </button>
                
                {/* Segunda fila: All Users */}
                <button
                  onClick={() => {
                    // Limpiar filtros de fecha
                    setDateFilter({ from: '', to: '' })
                    setFromDatePicker(new Date())
                    setToDatePicker(new Date())
                    // Cargar todos los datos de todos los usuarios
                    loadAllUsersHRVResults()
                  }}
                  disabled={loading}
                  className="group flex items-center justify-center space-x-1 sm:space-x-2 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 text-white px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none shadow-lg hover:shadow-xl"
                >
                  <Download className={`h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 ${loading ? 'animate-pulse' : 'group-hover:scale-110'} transition-transform duration-300`} />
                  <span className="font-semibold text-xs sm:text-sm lg:text-lg">
                    {loading ? `${t.kubios.loadingUsers} ${users.length} ${t.kubios.teamUsers.toLowerCase()}...` : t.kubios.allUsers}
                  </span>
                </button>
                
                {/* Segunda fila: Update Users */}
                <button
                  onClick={loadTeamUsers}
                  disabled={loading}
                  className="group flex items-center justify-center space-x-1 sm:space-x-2 bg-white/80 border border-gray-200 px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 rounded-xl text-gray-700 hover:border-purple-300 hover:bg-purple-50 transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none shadow-lg hover:shadow-xl"
                >
                  <div className="relative">
                    <Users className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 group-hover:scale-110 transition-transform duration-300" />
                    {loading && (
                      <div className="absolute -top-1 -right-1">
                        <RefreshCw className="h-2 w-2 sm:h-3 sm:w-3 animate-spin text-purple-500" />
                      </div>
                    )}
                  </div>
                  <span className="font-semibold text-xs sm:text-sm lg:text-lg">{t.kubios.updateUsers}</span>
                </button>
              </div>
            </div>

            {/* Filtros */}
            <div className="relative z-[9999999] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              <div className="relative group" ref={dropdownRef}>
                <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center">
                  <Users className="h-4 w-4 mr-2 text-blue-600" />
                  {t.kubios.teamUsers}
                </label>
                <div className="relative">
                  <button
                    ref={userDropdownButtonRef}
                    type="button"
                    onClick={() => {
                      const next = !isDropdownOpen
                      setIsDropdownOpen(next)
                      if (next) {
                        const rect = userDropdownButtonRef.current?.getBoundingClientRect()
                        if (rect) setDropdownPosition({ top: rect.bottom + 8, left: rect.left, width: rect.width })
                      }
                    }}
                    className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-white via-blue-50/50 to-indigo-50/50 border-2 border-blue-200/60 rounded-xl sm:rounded-2xl text-slate-700 focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-500 shadow-xl hover:shadow-2xl hover:border-blue-300/80 cursor-pointer font-medium group-hover:scale-[1.02] transform flex items-center justify-between"
                  >
                    <span className="text-left">
                      {selectedUser === 'all' ? t.kubios.allUsers :
                       selectedUser ? 
                        users.find(u => u.user_id === selectedUser)?.name || t.kubios.selectUser : 
                        t.kubios.selectUser
                      }
                    </span>
                    <ChevronDown className={`h-4 w-4 sm:h-5 sm:w-5 text-blue-500 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {/* Efecto de brillo en hover */}
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-transparent to-indigo-500/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                  
                  {/* Indicador de estado */}
                  <div className="absolute right-12 top-1/2 transform -translate-y-1/2 pointer-events-none">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  </div>
                </div>
                
                {/* Contador de usuarios */}
                <div className="absolute -top-2 -right-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg">
                  {users.length} {t.kubios.teamUsers.toLowerCase()}
                </div>

                {/* Dropdown personalizado (Portal) */}
                {isDropdownOpen && dropdownPosition && (
                  <Portal>
                    <div
                      ref={userDropdownPortalRef}
                      className="fixed bg-white border-2 border-blue-200/60 rounded-2xl shadow-2xl overflow-hidden"
                      style={{ zIndex: 9999999, top: dropdownPosition.top, left: dropdownPosition.left, width: dropdownPosition.width }}
                    >
                      <div 
                        className="max-h-80 overflow-y-auto"
                        onScroll={(e) => {
                          // Prevenir que el scroll se propague y cierre el dropdown
                          e.stopPropagation()
                        }}
                      >
                      <button
                        onClick={() => handleUserSelect('')}
                        className="w-full px-6 py-4 text-left hover:bg-blue-50 transition-colors duration-200 flex items-center justify-between group"
                      >
                        <span className="text-slate-600 font-medium">{t.kubios.selectUser}</span>
                        {!selectedUser && <Check className="h-5 w-5 text-blue-500" />}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedUser('all')
                          loadAllUsersHRVResults()
                          // No cerrar el dropdown inmediatamente para evitar el problema
                          setTimeout(() => setIsDropdownOpen(false), 100)
                        }}
                        className={`w-full px-6 py-4 text-left hover:bg-blue-50 transition-colors duration-200 flex items-center justify-between group border-t border-slate-100 ${
                          selectedUser === 'all' ? 'bg-blue-100' : ''
                        }`}
                      >
                        <div className="flex-1">
                          <div className="font-medium text-slate-700 group-hover:text-blue-700 transition-colors">
                            {t.kubios.allUsers}
                          </div>
                          <div className="text-sm text-slate-500 mt-1">
                            {t.kubios.loadingUsers} {users.length} {t.kubios.teamUsers.toLowerCase()}
                          </div>
                        </div>
                        {selectedUser === 'all' && (
                          <Check className="h-5 w-5 text-blue-500 flex-shrink-0" />
                        )}
                      </button>
                      {users.map((user, index) => (
                        <button
                          key={user.user_id || `user-${index}`}
                          onClick={() => handleUserSelect(user.user_id)}
                          className="w-full px-6 py-4 text-left hover:bg-blue-50 transition-colors duration-200 flex items-center justify-between group border-t border-slate-100"
                        >
                          <div className="flex-1">
                            <div className="font-medium text-slate-700 group-hover:text-blue-700 transition-colors">
                              {user.name}
                            </div>
                            <div className="text-sm text-slate-500 mt-1">
                              {user.measurement_count} {t.kubios.measurements}
                            </div>
                          </div>
                          {selectedUser === user.user_id && (
                            <Check className="h-5 w-5 text-blue-500 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                    </div>
                  </Portal>
                )}
              </div>
              
              <div className="relative group z-[9999999]" ref={fromDatePickerRef}>
                <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-green-500" />
                  {t.kubios.dateFrom}
                </label>
                <div className="relative">
                  <button
                    ref={fromDateRef}
                    type="button"
                    onClick={() => setIsFromDateOpen(!isFromDateOpen)}
                    className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-white via-green-50/50 to-emerald-50/50 border-2 border-green-200/60 rounded-xl sm:rounded-2xl text-slate-700 focus:ring-4 focus:ring-green-500/20 focus:border-green-500 transition-all duration-500 shadow-xl hover:shadow-2xl hover:border-green-300/80 cursor-pointer font-medium group-hover:scale-[1.02] transform flex items-center justify-between"
                  >
                    <span className="text-left">
                      {dateFilter.from ? formatDisplayDate(new Date(dateFilter.from)) : t.data.selectDate}
                    </span>
                    <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
                  </button>
                  
                  {/* Efecto de brillo en hover */}
                  <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 via-transparent to-emerald-500/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                </div>

                <Portal>
                  <CustomCalendar
                    isOpen={isFromDateOpen}
                    onClose={() => setIsFromDateOpen(false)}
                    selectedDate={fromDatePicker}
                    onDateChange={handleFromDateChange}
                    type="from"
                    color="from-green-500 to-emerald-500"
                    containerRef={fromCalendarPortalRef}
                    position={fromDatePosition || undefined}
                  />
                </Portal>
              </div>
              
              <div className="relative group z-[9999999]" ref={toDatePickerRef}>
                <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-purple-500" />
                  {t.kubios.dateTo}
                </label>
                <div className="relative">
                  <button
                    ref={toDateRef}
                    type="button"
                    onClick={() => setIsToDateOpen(!isToDateOpen)}
                    className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-white via-purple-50/50 to-pink-50/50 border-2 border-purple-200/60 rounded-xl sm:rounded-2xl text-slate-700 focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all duration-500 shadow-xl hover:shadow-2xl hover:border-purple-300/80 cursor-pointer font-medium group-hover:scale-[1.02] transform flex items-center justify-between"
                  >
                    <span className="text-left">
                      {dateFilter.to ? formatDisplayDate(new Date(dateFilter.to)) : t.data.selectDate}
                    </span>
                    <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-purple-500" />
                  </button>
                  
                  {/* Efecto de brillo en hover */}
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 via-transparent to-pink-500/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                </div>

                <Portal>
                  <CustomCalendar
                    isOpen={isToDateOpen}
                    onClose={() => setIsToDateOpen(false)}
                    selectedDate={toDatePicker}
                    onDateChange={handleToDateChange}
                    type="to"
                    color="from-purple-500 to-pink-500"
                    containerRef={toCalendarPortalRef}
                    position={toDatePosition || undefined}
                  />
                </Portal>
              </div>
            </div>

            {error && (
              <div className="relative z-10 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl mt-6">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="font-medium">{error}</span>
                </div>
              </div>
            )}
          </div>

          {/* Gráficos HRV */}
          {showCharts && selectedUser && hrvResults.length > 0 && (
            <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 mb-6 sm:mb-12 overflow-hidden shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-2xl sm:rounded-3xl"></div>
              <div className="relative z-10">
                <HRVCharts results={hrvResults} selectedUser={selectedUser} />
              </div>
            </div>
          )}

          {/* Resultados HRV */}
          {selectedUser && (
            <div className="relative bg-white/90 backdrop-blur-xl border border-blue-200/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 overflow-hidden shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-2xl sm:rounded-3xl"></div>
              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between mb-6 sm:mb-8 space-y-3 sm:space-y-0">
                <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  {t.kubios.hrvResults}
                  {users.find(u => u.user_id === selectedUser) && (
                    <span className="text-slate-600 ml-2 sm:ml-3 text-sm sm:text-lg font-normal">
                      - {users.find(u => u.user_id === selectedUser)?.name}
                    </span>
                  )}
                </h3>
                <div className="flex items-center space-x-2 bg-green-50 border border-green-200 px-3 sm:px-4 py-2 rounded-xl">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-xs sm:text-sm text-green-700 font-medium">
                    {hrvResults.length} {t.kubios.hrvResults.toLowerCase()} {t.common.found}
                  </span>
                </div>
              </div>

              {loading ? (
                <div className="relative z-10 flex items-center justify-center py-8 sm:py-16">
                  <div className="flex items-center space-x-3 sm:space-x-4 bg-white border border-blue-200 px-4 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl shadow-lg">
                    <RefreshCw className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-blue-600" />
                    <span className="text-slate-700 font-medium text-sm sm:text-base">{t.data.loading}</span>
                  </div>
                </div>
              ) : hrvResults.length === 0 ? (
                <div className="relative z-10 text-center py-8 sm:py-16">
                  <div className="p-4 sm:p-6 bg-blue-50 border border-blue-200 rounded-xl sm:rounded-2xl inline-block shadow-lg">
                    <Heart className="h-12 w-12 sm:h-16 sm:w-16 text-blue-500 mx-auto mb-3 sm:mb-4" />
                    <p className="text-slate-700 text-sm sm:text-lg font-medium">{t.kubios.noResults}</p>
                  </div>
                </div>
              ) : (
                <div className="relative z-10 space-y-4 sm:space-y-6">
                  {hrvResults.map((result, index) => (
                    <div key={result.result_id || `result-${index}`} className="relative bg-white border border-blue-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 hover:border-blue-300 hover:shadow-xl transition-all duration-500 transform hover:-translate-y-1 shadow-lg">
                      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
                        {/* Información básica */}
                        <div className="lg:col-span-1">
                          <div className="flex items-center space-x-3 sm:space-x-4 mb-4 sm:mb-6">
                            <div className="p-2 sm:p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg sm:rounded-xl shadow-lg">
                              <Calendar className="h-4 w-4 sm:h-6 sm:w-6 text-white" />
                            </div>
                            <div>
                              <p className="font-bold text-slate-800 text-sm sm:text-lg">
                                {formatDate(result.measured_timestamp)}
                              </p>
                              <p className="text-xs sm:text-sm text-slate-600">
                                {result.daily_result}
                              </p>
                            </div>
                          </div>
                          
                          {/* Readiness Score */}
                          <div className={`inline-flex items-center px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold shadow-lg ${getReadinessColorDark(result.result.readiness)}`}>
                            <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                            {result.result.readiness.toFixed(1)}% - {getReadinessLevel(result.result.readiness)}
                          </div>
                        </div>

                        {/* Métricas principales */}
                        <div className="lg:col-span-3">
                          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                            <div className="relative bg-blue-50 border border-blue-200 p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl hover:border-blue-300 transition-all duration-300 shadow-lg">
                              <div className="flex items-center space-x-2 sm:space-x-3 mb-2 sm:mb-3">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-md sm:rounded-lg">
                                  <Activity className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white" />
                                </div>
                                <span className="text-xs sm:text-sm font-bold text-slate-700">{t.kubios.metrics.meanHr}</span>
                              </div>
                              <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-blue-600 mb-1">
                                {result.result.mean_hr_bpm.toFixed(0)}
                              </p>
                              <p className="text-xs text-slate-600 font-medium">bpm</p>
                            </div>

                            <div className="relative bg-green-50 border border-green-200 p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl hover:border-green-300 transition-all duration-300 shadow-lg">
                              <div className="flex items-center space-x-2 sm:space-x-3 mb-2 sm:mb-3">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-md sm:rounded-lg">
                                  <Heart className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white" />
                                </div>
                                <span className="text-xs sm:text-sm font-bold text-slate-700">{t.kubios.metrics.rmssd}</span>
                              </div>
                              <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-green-600 mb-1">
                                {result.result.rmssd_ms.toFixed(1)}
                              </p>
                              <p className="text-xs text-slate-600 font-medium">ms</p>
                            </div>

                            <div className="relative bg-purple-50 border border-purple-200 p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl hover:border-purple-300 transition-all duration-300 shadow-lg">
                              <div className="flex items-center space-x-2 sm:space-x-3 mb-2 sm:mb-3">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-md sm:rounded-lg">
                                  <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white" />
                                </div>
                                <span className="text-xs sm:text-sm font-bold text-slate-700">{t.kubios.metrics.pnsIndex}</span>
                              </div>
                              <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-purple-600 mb-1">
                                {result.result.pns_index.toFixed(2)}
                              </p>
                              <p className="text-xs text-slate-600 font-medium">parasimpático</p>
                            </div>

                            <div className="relative bg-orange-50 border border-orange-200 p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl hover:border-orange-300 transition-all duration-300 shadow-lg">
                              <div className="flex items-center space-x-2 sm:space-x-3 mb-2 sm:mb-3">
                                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-md sm:rounded-lg">
                                  <Activity className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white" />
                                </div>
                                <span className="text-xs sm:text-sm font-bold text-slate-700">{t.kubios.metrics.snsIndex}</span>
                              </div>
                              <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-orange-600 mb-1">
                                {result.result.sns_index.toFixed(2)}
                              </p>
                              <p className="text-xs text-slate-600 font-medium">simpático</p>
                            </div>
                          </div>

                          {/* Métricas adicionales */}
                          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mt-6 sm:mt-8">
                            <div className="text-center bg-slate-50 border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-slate-300 transition-all duration-300 shadow-lg">
                              <p className="text-xs sm:text-sm text-slate-600 font-medium mb-1 sm:mb-2">{t.kubios.metrics.physiologicalAge}</p>
                              <p className="text-lg sm:text-xl font-bold text-slate-800">
                                {result.result.physiological_age.toFixed(1)} {t.kubios.metrics.years}
                              </p>
                            </div>
                            <div className="text-center bg-slate-50 border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-slate-300 transition-all duration-300 shadow-lg">
                              <p className="text-xs sm:text-sm text-slate-600 font-medium mb-1 sm:mb-2">{t.kubios.metrics.respiratoryRate}</p>
                              <p className="text-lg sm:text-xl font-bold text-slate-800">
                                {result.result.respiratory_rate.toFixed(1)} min⁻¹
                              </p>
                            </div>
                            <div className="text-center bg-slate-50 border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-slate-300 transition-all duration-300 shadow-lg">
                              <p className="text-xs sm:text-sm text-slate-600 font-medium mb-1 sm:mb-2">{t.kubios.metrics.stressIndex}</p>
                              <p className="text-lg sm:text-xl font-bold text-slate-800">
                                {result.result.stress_index.toFixed(1)}
                              </p>
                            </div>
                            <div className="text-center bg-slate-50 border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-slate-300 transition-all duration-300 shadow-lg">
                              <p className="text-xs sm:text-sm text-slate-600 font-medium mb-1 sm:mb-2">{t.kubios.metrics.quality}</p>
                              <p className="text-lg sm:text-xl font-bold text-slate-800">
                                {result.result.artefact_level}
                              </p>
                            </div>
                          </div>

                          {/* Dominio de frecuencia */}
                          <div className="mt-6 sm:mt-8 p-4 sm:p-6 bg-indigo-50 border border-indigo-200 rounded-xl sm:rounded-2xl shadow-lg">
                            <h4 className="text-base sm:text-lg font-bold text-slate-800 mb-4 sm:mb-6 flex items-center">
                              <div className="p-1.5 sm:p-2 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-md sm:rounded-lg mr-2 sm:mr-3">
                                <Activity className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 text-white" />
                              </div>
                              {t.kubios.metrics.freqDomain}
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                              <div className="text-center bg-white border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-slate-300 transition-all duration-300 shadow-lg">
                                <p className="text-xs text-slate-600 font-medium mb-1 sm:mb-2">{t.kubios.metrics.hfPower}</p>
                                <p className="text-sm sm:text-lg font-bold text-slate-800">
                                  {result.result.freq_domain.HF_power.toFixed(1)}
                                </p>
                              </div>
                              <div className="text-center bg-white border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-slate-300 transition-all duration-300 shadow-lg">
                                <p className="text-xs text-slate-600 font-medium mb-1 sm:mb-2">{t.kubios.metrics.lfPower}</p>
                                <p className="text-sm sm:text-lg font-bold text-slate-800">
                                  {result.result.freq_domain.LF_power.toFixed(1)}
                                </p>
                              </div>
                              <div className="text-center bg-white border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-slate-300 transition-all duration-300 shadow-lg">
                                <p className="text-xs text-slate-600 font-medium mb-1 sm:mb-2">{t.kubios.metrics.vlfPower}</p>
                                <p className="text-sm sm:text-lg font-bold text-slate-800">
                                  {result.result.freq_domain.VLF_power.toFixed(1)}
                                </p>
                              </div>
                              <div className="text-center bg-white border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-slate-300 transition-all duration-300 shadow-lg">
                                <p className="text-xs text-slate-600 font-medium mb-1 sm:mb-2">{t.kubios.metrics.totalPower}</p>
                                <p className="text-sm sm:text-lg font-bold text-slate-800">
                                  {result.result.freq_domain.tot_power.toFixed(1)}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
