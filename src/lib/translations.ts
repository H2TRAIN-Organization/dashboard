// Sistema de traducciones para la aplicación
export type Language = 'es' | 'en'

export interface Translations {
  // Navegación
  navigation: {
    dashboard: string
    users: string
    data: string
    kubios: string
    analytics: string
    study: string
    admin: string
    settings: string
    database: string
    roles: string
  }
  
  // Autenticación
  auth: {
    login: string
    logout: string
    signIn: string
    signUp: string
    email: string
    password: string
    username: string
    welcome: string
    createAccount: string
    joinPlatform: string
    accessAdmin: string
    accessUser: string
    invalidCredentials: string
    unexpectedError: string
    loggingIn: string
    creatingAccount: string
    showPassword: string
    hidePassword: string
    noAccount: string
    register: string
    or: string
    adminAccess: string
    appUserAccess: string
    // Features del login
    realtimeMonitoring: string
    realtimeMonitoringDesc: string
    intelligentAnalysis: string
    intelligentAnalysisDesc: string
    teamManagement: string
    teamManagementDesc: string
    advancedSecurity: string
    advancedSecurityDesc: string
  }
  
  // Dashboard
  dashboard: {
    title: string
    subtitle: string
    advancedControl: string
    healthMonitoring: string
    manageUsers: string
    analyzeData: string
    monitorMetrics: string
    totalUsers: string
    totalRecords: string
    hrvUsers: string
    systemAccuracy: string
      myRecords: string
      myHrv: string
      myStatus: string
      myProgress: string
      healthy: string
      active: string
      // Estados específicos
      activeStatus: string
      healthyStatus: string
    navigation: string
    premiumFeatures: string
    systemStatus: string
    uptime: string
    activeUsers: string
    userManagement: string
    healthData: string
    advancedAnalytics: string
    hrvAnalysis: string
    correlationStudy: string
    administration: string
    access: string
    userManagementDescription: string
    healthDataDescription: string
    advancedAnalyticsDescription: string
    hrvAnalysisDescription: string
    correlationStudyDescription: string
    administrationDescription: string
    generalSummary: string
    cuttingEdgeTechnology: string
    intelligentMonitoring: string
    advancedPlatform: string
    advancedSecurity: string
    endToEndEncryption: string
    moreInformation: string
    predictiveAnalysis: string
    machineLearningAlgorithms: string
    exploreAI: string
    continuousMonitoring: string
    tracking24_7: string
    viewMetrics: string
    advancedSystem: string
    logout: string
    adminPanel: string
    adminDescription: string
    createUser: string
    searchUsers: string
    username: string
    email: string
    role: string
    actions: string
    edit: string
    delete: string
    save: string
    cancel: string
    clearUUID: string
    confirmClearUUID: string
    userCreated: string
    userUpdated: string
    userDeleted: string
    uuidCleared: string
    errorOccurred: string
    admin: string
    doctor: string
    user: string
    selectRole: string
    roleUpdated: string
    exportCSV: string
    food: string
    periods: string
    mood: string
    total: string
    type: string
    dose: string
    quantity: string
    carbs: string
    intensity: string
    description: string
    symptoms: string
    notes: string
    value: string
    outOfRoutine: string
    emotions: string
    yes: string
    no: string
    dataFilters: string
    clearFilters: string
    allUsers: string
    dataType: string
    allTypes: string
    timeRange: string
    allTime: string
    specificDate: string
    selectDate: string
    lastActivity: string
    records: string
    showLess: string
    viewAll: string
    records2: string
    insulin: string
    insulinData: string
    meals: string
    exercise: string
    loadingData: string
    connectingServer: string
    decryptingData: string
    processingInfo: string
    finalizing: string
    noDataFound: string
    noRecordsForFilters: string
    analyzingStudyData: string
    processingCorrelations: string
    // App Dashboard específico
    appDashboard: {
      myHealthPanel: string
      advancedControlPanel: string
      myHealthData: string
      myHrvAnalysis: string
      myStatistics: string
      viewMyData: string
      viewMyHrv: string
      viewStatistics: string
      userManagement: string
      healthData: string
      advancedAnalytics: string
      hrvAnalysis: string
      correlationStudy: string
      administration: string
      access: string
      total: string
      records: string
      users: string
      precision: string
      study: string
      analysis: string
      panel: string
      administrator: string
      physician: string
      user: string
      signOut: string
    }
  }
  
  // Datos
  data: {
    title: string
    myData: string
    allUsers: string
    user: string
    dataType: string
    timeRange: string
    date: string
    clearFilters: string
    exportCsv: string
    insulin: string
    meals: string
    exercise: string
    periods: string
    mood: string
    total: string
    all: string
    last7Days: string
    last30Days: string
    last90Days: string
    insulinData: string
    foodData: string
    exerciseData: string
    periodData: string
    moodData: string
    noData: string
    loading: string
    error: string
  }
  
  // HRV/Kubios
  kubios: {
    title: string
    subtitle: string
    teamUsers: string
    selectUser: string
    allUsers: string
    measurements: string
    noResults: string
    dateFrom: string
    dateTo: string
    updateUsers: string
    loadingUsers: string
    errorLoadingUsers: string
    hrvResults: string
    noHrvResults: string
    showCharts: string
    hideCharts: string
    // Métricas HRV
    metrics: {
      meanHr: string
      rmssd: string
      pnsIndex: string
      snsIndex: string
      physiologicalAge: string
      respiratoryRate: string
      stressIndex: string
      quality: string
      freqDomain: string
      hfPower: string
      lfPower: string
      vlfPower: string
      totalPower: string
      years: string
    }
    // Niveles de readiness
    readinessLevels: {
      high: string
      normal: string
      low: string
      veryLow: string
    }
    // Gráficos HRV
    charts: {
      readinessEvolution: string
      rmssdEvolution: string
      pnsSnsIndices: string
      heartRateRest: string
      frequencyDomain: string
      averageReadiness: string
      averageRmssd: string
      averageHeartRate: string
      lastRecords: string
      heartRateVariability: string
      heartRate: string
      date: string
      readinessPercentage: string
      rmssdMs: string
      heartRateBpm: string
      pnsSnsIndicesLabel: string
      heartRateLabel: string
      spectralPower: string
      hfPower: string
      lfPower: string
      vlfPower: string
      pnsIndex: string
      snsIndex: string
      heartRateRestLabel: string
    }
  }
  
  // Analytics
  analytics: {
    title: string
    subtitle: string
    statistics: string
    trends: string
    insights: string
    recommendations: string
    charts: string
    data: string
    analysis: string
    generalStats: string
    additionalStats: string
    activityChart: string
    dataTypeCharts: string
    insulinByType: string
    insulinTypesUsed: string
    averageInsulinDose: string
    moodDistribution: string
    temporalEvolution: string
    insulinEvolution: string
    mealEvolution: string
    exerciseEvolution: string
    moodEvolution: string
    insulinCorrelation: string
    injections: string
    insulinType: string
    type: string
    records: string
    moodLevel: string
    sessions: string
    exercise: string
    mood: string
    meals: string
    insulin: string
    insulinInjections: string
    registeredMeals: string
    exerciseSessions: string
    moodRecords: string
    numberOfMeals: string
    date: string
    level: string
    injectionsPerDay: string
    dailyInsulinDoses: string
    insulinTypes: string
    mealTypes: string
    moodLevels: string
    activityOverTime: string
    dataDistribution: string
    temporalTrends: string
    correlations: string
    generalActivityByDate: string
    registeredMealTypes: string
    // Textos específicos de gráficos
    average: string
    units: string
    carbohydrates: string
    registeredSessions: string
    cycleRecords: string
    allTypes: string
    mostRecentDate: string
    showsInsulinTypes: string
    eachSector: string
    percentageUsage: string
    showsMealTypes: string
    xAxis: string
    yAxis: string
    numberOfRecords: string
    showsAverageInsulin: string
    numberOfInjections: string
    showsMoodFrequency: string
    verySad: string
    veryHappy: string
    percentageRecords: string
    showsInsulinInjections: string
    showsMealRegistrations: string
    showsExerciseSessions: string
    numberOfSessions: string
    showsMoodRecords: string
    numberOfMoodRecords: string
    foodTypes: string
    dates: string
    quantity: string
    mealType: string
    exerciseType: string
  }
  
  // Overview
  overview: {
    title: string
    subtitle: string
    systemActive: string
    totalUsersOverview: string
    totalRecordsOverview: string
    averageInsulin: string
    moodLevel: string
    unitsPerRecord: string
    generalAverage: string
    insulin: string
    meals: string
    exercise: string
    periods: string
    mood: string
    systemAlerts: string
    activityLast7Days: string
    mostActiveUsers: string
    recentActivity: string
    additionalSystemMetrics: string
    averageCarbs: string
    recordsPerUser: string
    unknown: string
    activeUsers: string
    lastActivity: string
    systemOverview: string
    healthTrackingSystem: string
    onlyActiveUsers: string
    noRecentActivity: string
    dataDistributionByType: string
    daysSinceLastActivity: string
    activeUsersRate: string
  }
  
  // Estudio
  study: {
    title: string
    subtitle: string
    correlations: string
    insights: string
    recommendations: string
    dataSummary: string
    hrvData: string
    exerciseData: string
    moodData: string
    temporalEvolution: string
    correlationAnalysis: string
    exerciseVsHrv: string
    intensityVsHrv: string
    last3Months: string
    lastMonth: string
    lastWeek: string
  }
  
  // Admin
  admin: {
    title: string
    subtitle: string
    systemConfig: string
    database: string
    userManagement: string
    roles: string
    settings: string
    backup: string
    export: string
    statistics: string
    tables: string
    records: string
    tableExplorer: string
    viewTables: string
    refreshStats: string
    exportData: string
    createBackup: string
    description: string
    databaseManagement: string
    dataManagement: string
    databaseDescription: string
    manageDatabase: string
    access: string
    systemStatus: string
    realTimeMonitoring: string
    operational: string
    databaseSize: string
    uptime: string
    totalRecords: string
    systemUptime: string
    userManagementDesc: string
    advancedAnalyticsDesc: string
    configurationDesc: string
    recordsLabel: string
    usersLabel: string
    uptimeLabel: string
    lastBackup: string
    tableStructure: string
    tableContent: string
    databaseOperations: string
    systemMetrics: string
  }
  
  // Usuarios
  users: {
    title: string
    subtitle: string
    createUser: string
    search: string
    username: string
    email: string
    role: string
    actions: string
    edit: string
    delete: string
    save: string
    cancel: string
    create: string
    update: string
    userCreated: string
    userUpdated: string
    userDeleted: string
    confirmDelete: string
    admin: string
    doctor: string
    user: string
    total: string
    active: string
    status: string
    gdpr: string
    activeStatus: string
    yes: string
    no: string
    copyUUID: string
    clearUUID: string
    editUser: string
    createNewUser: string
    usernameLabel: string
    passwordLabel: string
    roleLabel: string
    information: string
    userInfo: string
    saving: string
    creating: string
    gdprConsent: string
    currentUUID: string
    noUUIDAssigned: string
    userWillBeCreated: string
  }
  
  // Roles
  roles: {
    admin: string
    doctor: string
    user: string
    administrator: string
    physician: string
    patient: string
  }
  
  // Común
  common: {
    loading: string
    error: string
    success: string
    warning: string
    info: string
    confirm: string
    cancel: string
    save: string
    delete: string
    edit: string
    create: string
    update: string
    back: string
    next: string
    previous: string
    search: string
    filter: string
    clear: string
    export: string
    import: string
    download: string
    upload: string
    refresh: string
    retry: string
    yes: string
    no: string
    ok: string
    close: string
    found: string
    language: string
  }
  
  // Datepicker
  datepicker: {
    months: string[]
    days: string[]
    today: string
    close: string
  }
}

export const translations: Record<Language, Translations> = {
  es: {
    navigation: {
      dashboard: 'Dashboard',
      users: 'Usuarios',
      data: 'Datos',
      kubios: 'Kubios',
      analytics: 'Analytics',
      study: 'Estudio',
      admin: 'Admin',
      settings: 'Configuración',
      database: 'Base de Datos',
      roles: 'Roles'
    },
    auth: {
      login: 'Iniciar Sesión',
      logout: 'Cerrar Sesión',
      signIn: 'Iniciar Sesión',
      signUp: 'Crear Cuenta',
      email: 'Email',
      password: 'Contraseña',
      username: 'Nombre de Usuario',
      welcome: 'Bienvenido',
      createAccount: 'Crear Cuenta',
      joinPlatform: 'Únete a nuestra plataforma de salud',
      accessAdmin: 'Accede a tu panel de administración',
      accessUser: 'Accede a tu panel de usuario',
      invalidCredentials: 'Credenciales inválidas',
      unexpectedError: 'Error inesperado al iniciar sesión',
      loggingIn: 'Iniciando sesión...',
      creatingAccount: 'Creando cuenta...',
      showPassword: 'Mostrar contraseña',
      hidePassword: 'Ocultar contraseña',
      noAccount: '¿No tienes cuenta? Regístrate',
      register: 'Regístrate',
      or: 'o',
      adminAccess: 'Acceso para administradores (con email)',
      appUserAccess: 'Acceso para usuarios de la app',
      // Features del login
      realtimeMonitoring: 'Monitoreo en Tiempo Real',
      realtimeMonitoringDesc: 'Seguimiento continuo de datos de salud con tecnología avanzada',
      intelligentAnalysis: 'Análisis Inteligente',
      intelligentAnalysisDesc: 'Gráficos interactivos y estadísticas detalladas con IA',
      teamManagement: 'Gestión de Equipos',
      teamManagementDesc: 'Administración completa de usuarios y equipos de investigación',
      advancedSecurity: 'Seguridad Avanzada',
      advancedSecurityDesc: 'Protección de datos con encriptación de grado médico'
    },
    dashboard: {
      title: 'Diabetes Tracker',
      subtitle: 'Monitoreo inteligente de la salud con tecnología de vanguardia. Gestiona usuarios, analiza datos y supervisa métricas de variabilidad cardíaca.',
      advancedControl: 'Panel de Control Avanzado',
      healthMonitoring: 'Mi Panel de Salud',
      manageUsers: 'Gestiona usuarios, analiza datos y supervisa métricas de variabilidad cardíaca.',
      analyzeData: 'Visualiza tus datos, analiza tu progreso y supervisa tus métricas de variabilidad cardíaca.',
      monitorMetrics: 'Monitoreo personal de tu salud con tecnología de vanguardia.',
      totalUsers: 'Usuarios Totales',
      totalRecords: 'Registros Totales',
      hrvUsers: 'Usuarios HRV',
      systemAccuracy: 'Precisión Sistema',
      myRecords: 'Mis Registros',
      myHrv: 'Mi HRV',
      myStatus: 'Mi Estado',
      myProgress: 'Mi Progreso',
      healthy: 'Saludable',
      active: 'Activo',
      // Estados específicos
      activeStatus: 'Activo',
      healthyStatus: 'Saludable',
      navigation: 'Navegación',
      premiumFeatures: 'Características Premium',
      systemStatus: 'Estado del Sistema',
      uptime: 'Tiempo de Actividad',
      activeUsers: 'Usuarios Activos',
      userManagement: 'Gestión de Usuarios',
      healthData: 'Datos de Salud',
      advancedAnalytics: 'Análisis Avanzado',
      hrvAnalysis: 'Kubios HRV',
      correlationStudy: 'Estudio Diabetes & Ejercicio',
      administration: 'Administración',
      access: 'Acceder',
      userManagementDescription: 'Administra perfiles, permisos y configuraciones del sistema',
      healthDataDescription: 'Visualiza y gestiona todos los datos de salud de los usuarios',
      advancedAnalyticsDescription: 'Análisis avanzado con inteligencia artificial y machine learning',
      hrvAnalysisDescription: 'Análisis de variabilidad cardíaca con tecnología Kubios',
      correlationStudyDescription: 'Correlaciones entre actividad física, HRV y control glucémico',
      administrationDescription: 'Configuración del sistema, base de datos y roles de usuario',
      generalSummary: 'Resumen General',
      cuttingEdgeTechnology: 'Tecnología de Vanguardia',
      intelligentMonitoring: 'Monitoreo Inteligente',
      advancedPlatform: 'Plataforma avanzada de seguimiento de salud que combina análisis de datos, variabilidad cardíaca y métricas de bienestar para una gestión integral.',
      advancedSecurity: 'Seguridad Avanzada',
      endToEndEncryption: 'Encriptación de extremo a extremo y protocolos de seguridad de grado médico para proteger la información sensible de los usuarios.',
      moreInformation: 'Más información',
      predictiveAnalysis: 'Análisis Predictivo',
      machineLearningAlgorithms: 'Algoritmos de machine learning que identifican patrones y predicen tendencias de salud para una intervención temprana.',
      exploreAI: 'Explorar IA',
      continuousMonitoring: 'Monitoreo Continuo',
      tracking24_7: 'Seguimiento 24/7 de métricas vitales con alertas inteligentes y notificaciones personalizadas para el cuidado proactivo.',
      viewMetrics: 'Ver métricas',
      advancedSystem: 'Sistema Avanzado',
      logout: 'Cerrar sesión',
      adminPanel: 'Panel de Administración',
      adminDescription: 'Gestiona usuarios, configura el sistema y supervisa la seguridad. Herramientas avanzadas para el control total de la plataforma.',
      createUser: 'Crear Usuario',
      searchUsers: 'Buscar usuarios...',
      username: 'Nombre de Usuario',
      email: 'Email',
      role: 'Rol',
      actions: 'Acciones',
      edit: 'Editar',
      delete: 'Eliminar',
      save: 'Guardar',
      cancel: 'Cancelar',
      clearUUID: 'Limpiar UUID',
      confirmClearUUID: '¿Estás seguro de que quieres limpiar el UUID de este usuario?',
      userCreated: 'Usuario creado exitosamente',
      userUpdated: 'Usuario actualizado exitosamente',
      userDeleted: 'Usuario eliminado exitosamente',
      uuidCleared: 'UUID limpiado exitosamente',
      errorOccurred: 'Ocurrió un error',
      admin: 'Administrador',
      doctor: 'Médico',
      user: 'Usuario',
      selectRole: 'Seleccionar rol',
      roleUpdated: 'Rol actualizado exitosamente',
      exportCSV: 'Exportar CSV',
      food: 'Comidas',
      periods: 'Períodos',
      mood: 'Estado de Ánimo',
      total: 'Total',
      type: 'Tipo',
      dose: 'Dosis',
      quantity: 'Cantidad',
      carbs: 'Carbohidratos',
      intensity: 'Intensidad',
      description: 'Descripción',
      symptoms: 'Síntomas',
      notes: 'Notas',
      value: 'Valor',
      outOfRoutine: 'Fuera de rutina',
      emotions: 'Emociones',
      yes: 'Sí',
      no: 'No',
      dataFilters: 'Filtros de Datos',
      clearFilters: 'Limpiar filtros',
      allUsers: 'Todos los usuarios',
      dataType: 'Tipo de Dato',
      allTypes: 'Todos los tipos',
      timeRange: 'Rango de Tiempo',
      allTime: 'Todo el tiempo',
      specificDate: 'Fecha Específica',
      selectDate: 'Seleccionar fecha',
      lastActivity: 'Última actividad',
      insulinData: 'Datos de Insulina',
      records: 'registros',
      showLess: 'Mostrar menos',
      viewAll: 'Ver todos los',
      records2: 'registros',
      insulin: 'Insulina',
      meals: 'Comidas',
      exercise: 'Ejercicio',
      loadingData: 'Cargando datos...',
      connectingServer: 'Conectando al servidor...',
      decryptingData: 'Descifrando datos...',
      processingInfo: 'Procesando información...',
      finalizing: 'Finalizando...',
      noDataFound: 'No se encontraron datos',
      noRecordsForFilters: 'No hay registros para los filtros seleccionados.',
      analyzingStudyData: 'Analizando Datos del Estudio',
      processingCorrelations: 'Procesando correlaciones entre diabetes, ejercicio y HRV...',
      // App Dashboard específico
      appDashboard: {
        myHealthPanel: 'Mi Panel de Salud',
        advancedControlPanel: 'Panel de Control Avanzado',
        myHealthData: 'Mis Datos de Salud',
        myHrvAnalysis: 'Mi Análisis HRV',
        myStatistics: 'Mis Estadísticas',
        viewMyData: 'Ver mis datos',
        viewMyHrv: 'Ver mi HRV',
        viewStatistics: 'Ver estadísticas',
        userManagement: 'Gestión de Usuarios',
        healthData: 'Datos de Salud',
        advancedAnalytics: 'Análisis Avanzado',
        hrvAnalysis: 'Análisis HRV',
        correlationStudy: 'Estudio de Correlaciones',
        administration: 'Administración',
        access: 'Acceder',
        total: 'Total',
        records: 'Registros',
        users: 'Usuarios',
        precision: 'Precisión',
        study: 'Estudio',
        analysis: 'Análisis',
        panel: 'Panel',
        administrator: 'Administrador',
        physician: 'Médico',
        user: 'Usuario',
        signOut: 'Cerrar Sesión'
      }
    },
    data: {
      title: 'Datos de Salud',
      myData: 'Mis Datos de Salud',
      allUsers: 'Todos los usuarios',
      user: 'Usuario',
      dataType: 'Tipo de Dato',
      timeRange: 'Rango de Tiempo',
      date: 'Fecha',
      clearFilters: 'Limpiar filtros',
      exportCsv: 'Exportar CSV',
      insulin: 'Insulina',
      meals: 'Comidas',
      exercise: 'Ejercicio',
      periods: 'Períodos',
      mood: 'Estado de Ánimo',
      total: 'Total',
      all: 'Todos',
      last7Days: 'Últimos 7 días',
      last30Days: 'Últimos 30 días',
      last90Days: 'Últimos 90 días',
      insulinData: 'Datos de Insulina',
      foodData: 'Datos de Comida',
      exerciseData: 'Datos de Ejercicio',
      periodData: 'Datos de Períodos',
      moodData: 'Datos de Estado de Ánimo',
      noData: 'No hay datos disponibles',
      loading: 'Cargando...',
      error: 'Error al cargar los datos'
    },
    kubios: {
      title: 'Kubios HRV - Variabilidad Cardíaca',
      subtitle: 'Análisis avanzado de variabilidad del ritmo cardíaco',
      teamUsers: 'Usuarios del Equipo',
      selectUser: 'Seleccionar Usuario',
      allUsers: 'Todos los usuarios',
      measurements: 'mediciones',
      noResults: 'No se encontraron resultados HRV para este usuario',
      dateFrom: 'Fecha desde',
      dateTo: 'Fecha hasta',
      updateUsers: 'Actualizar Usuarios',
      loadingUsers: 'Cargando usuarios...',
      errorLoadingUsers: 'ERROR AL CARGAR USUARIOS',
      hrvResults: 'Resultados HRV',
      noHrvResults: 'No hay resultados HRV disponibles',
      showCharts: 'Mostrar Gráficos',
      hideCharts: 'Ocultar Gráficos',
      // Métricas HRV
      metrics: {
        meanHr: 'FC Reposo',
        rmssd: 'RMSSD',
        pnsIndex: 'PNS Index',
        snsIndex: 'SNS Index',
        physiologicalAge: 'Edad Fisiológica',
        respiratoryRate: 'Frecuencia Respiratoria',
        stressIndex: 'Índice de Estrés',
        quality: 'Calidad',
        freqDomain: 'Dominio de Frecuencia',
        hfPower: 'HF Power',
        lfPower: 'LF Power',
        vlfPower: 'VLF Power',
        totalPower: 'Total Power',
        years: 'años'
      },
      // Niveles de readiness
      readinessLevels: {
        high: 'ALTO',
        normal: 'NORMAL',
        low: 'BAJO',
        veryLow: 'MUY BAJO'
      },
      // Gráficos HRV
      charts: {
        readinessEvolution: 'Evolución del Readiness',
        rmssdEvolution: 'Evolución del RMSSD',
        pnsSnsIndices: 'Índices PNS vs SNS',
        heartRateRest: 'Frecuencia Cardíaca en Reposo',
        frequencyDomain: 'Dominio de Frecuencia',
        averageReadiness: 'Readiness Promedio',
        averageRmssd: 'RMSSD Promedio',
        averageHeartRate: 'FC Promedio',
        lastRecords: 'Últimos {count} registros',
        heartRateVariability: 'Variabilidad cardíaca',
        heartRate: 'Frecuencia cardíaca',
        date: 'Fecha',
        readinessPercentage: 'HRV Readiness (%)',
        rmssdMs: 'RMSSD (ms)',
        heartRateBpm: 'Frecuencia Cardíaca (bpm)',
        pnsSnsIndicesLabel: 'Índices PNS/SNS',
        heartRateLabel: 'FC Reposo',
        spectralPower: 'Potencia Espectral (ms²)',
        hfPower: 'HF Power',
        lfPower: 'LF Power',
        vlfPower: 'VLF Power',
        pnsIndex: 'PNS Index',
        snsIndex: 'SNS Index',
        heartRateRestLabel: 'FC Reposo'
      }
    },
    analytics: {
      title: 'Análisis y Estadísticas',
      subtitle: 'Estadísticas detalladas y análisis de tendencias',
      statistics: 'Estadísticas',
      trends: 'Tendencias',
      insights: 'Insights',
      recommendations: 'Recomendaciones',
      charts: 'Gráficos',
      data: 'Datos',
      analysis: 'Análisis',
      generalStats: 'Estadísticas Generales',
      additionalStats: 'Estadísticas Adicionales',
      activityChart: 'Gráfico de Actividad General',
      dataTypeCharts: 'Gráficos por Tipo de Dato',
      insulinByType: 'Insulina por Tipo',
      insulinTypesUsed: 'Tipos de Insulina Utilizados',
      averageInsulinDose: 'Promedio de Dosis de Insulina por Día',
      moodDistribution: 'Distribución de Estado de Ánimo',
      temporalEvolution: 'Evolución Temporal',
      insulinEvolution: 'Evolución de Registros de Insulina',
      mealEvolution: 'Evolución de Registros de Comidas',
      exerciseEvolution: 'Evolución de Registros de Ejercicio',
      moodEvolution: 'Evolución de Registros de Estado de Ánimo',
      insulinCorrelation: 'Correlación Insulina vs Carbohidratos',
      injections: 'inyecciones',
      insulinType: 'Tipo de Insulina',
      type: 'Tipo',
      records: 'registros',
      moodLevel: 'Nivel',
      sessions: 'sesiones',
      exercise: 'Ejercicio',
      mood: 'Estado de Ánimo',
      meals: 'Comidas',
      insulin: 'Insulina',
      insulinInjections: 'Inyecciones de Insulina',
      registeredMeals: 'Comidas Registradas',
      exerciseSessions: 'Sesiones de Ejercicio',
      moodRecords: 'Registros de Estado de Ánimo',
      numberOfMeals: 'Número de Comidas',
      date: 'Fecha',
      level: 'Nivel',
      injectionsPerDay: 'Inyecciones por Día',
      dailyInsulinDoses: 'Dosis Diarias de Insulina',
      insulinTypes: 'Tipos de Insulina',
      mealTypes: 'Tipos de Comida',
      moodLevels: 'Niveles de Estado de Ánimo',
      activityOverTime: 'Actividad a lo Largo del Tiempo',
      dataDistribution: 'Distribución de Datos',
      temporalTrends: 'Tendencias Temporales',
      correlations: 'Correlaciones',
      generalActivityByDate: 'Actividad General por Fecha',
      registeredMealTypes: 'Tipos de Comida Registrados',
      // Textos específicos de gráficos
      average: 'Promedio',
      units: 'unidades',
      carbohydrates: 'carbohidratos',
      registeredSessions: 'Sesiones registradas',
      cycleRecords: 'Registros de ciclo',
      allTypes: 'Todos los tipos',
      mostRecentDate: 'Fecha más reciente',
      showsInsulinTypes: 'Muestra qué tipos de insulina se usan más frecuentemente.',
      eachSector: 'Cada sector',
      percentageUsage: 'Porcentaje de uso de cada tipo',
      showsMealTypes: 'Muestra qué tipos de comida se registran más frecuentemente.',
      xAxis: 'Eje X',
      yAxis: 'Eje Y',
      numberOfRecords: 'Número de Registros',
      showsAverageInsulin: 'Muestra la cantidad promedio de insulina administrada cada día.',
      numberOfInjections: 'Número de inyecciones',
      showsMoodFrequency: 'Muestra qué tan frecuente es cada nivel de estado de ánimo (0=Muy triste, 10=Muy feliz).',
      verySad: 'Muy triste',
      veryHappy: 'Muy feliz',
      percentageRecords: 'Porcentaje de registros con ese nivel',
      showsInsulinInjections: 'Muestra cuántas inyecciones de insulina se registraron cada día.',
      showsMealRegistrations: 'Muestra cuántas comidas se registraron cada día.',
      showsExerciseSessions: 'Muestra cuántas sesiones de ejercicio se registraron cada día.',
      numberOfSessions: 'Número de Sesiones',
      showsMoodRecords: 'Muestra cuántos registros de estado de ánimo se hicieron cada día.',
      numberOfMoodRecords: 'Número de Registros',
      foodTypes: 'Tipos de Comida',
      dates: 'Fechas',
      quantity: 'Cantidad',
      mealType: 'Tipo de Comida',
      exerciseType: 'Tipo de Ejercicio'
    },
    overview: {
      title: 'Resumen General del Sistema',
      subtitle: 'Vista general y métricas principales del sistema de seguimiento de salud',
      systemActive: 'Sistema Activo',
      totalUsersOverview: 'Total Usuarios',
      totalRecordsOverview: 'Total Registros',
      averageInsulin: 'Promedio Insulina',
      moodLevel: 'Estado de Ánimo',
      unitsPerRecord: 'unidades por registro',
      generalAverage: 'promedio general',
      insulin: 'Insulina',
      meals: 'Comidas',
      exercise: 'Ejercicio',
      periods: 'Períodos',
      mood: 'Estado de Ánimo',
      systemAlerts: 'Alertas del Sistema',
      activityLast7Days: 'Actividad de los Últimos 7 Días',
      mostActiveUsers: 'Usuarios Más Activos',
      recentActivity: 'Actividad Reciente',
      additionalSystemMetrics: 'Métricas Adicionales del Sistema',
      averageCarbs: 'Promedio carbohidratos',
      recordsPerUser: 'Registros por usuario',
      unknown: 'Desconocido',
      activeUsers: 'Usuarios activos',
      lastActivity: 'Última actividad del sistema',
      systemOverview: 'Resumen General del Sistema',
      healthTrackingSystem: 'Vista general y métricas principales del sistema de seguimiento de salud',
      onlyActiveUsers: 'Solo {active} de {total} usuarios están activos (últimos 7 días)',
      noRecentActivity: 'No hay actividad reciente en el sistema (más de 7 días)',
      dataDistributionByType: 'Distribución por Tipo de Dato',
      daysSinceLastActivity: 'Días desde última actividad',
      activeUsersRate: 'Tasa de usuarios activos'
    },
    study: {
      title: 'Estudio de Correlaciones',
      subtitle: 'Análisis de correlaciones entre ejercicio y métricas de HRV',
      correlations: 'Correlaciones',
      insights: 'Insights del Estudio',
      recommendations: 'Recomendaciones',
      dataSummary: 'Resumen de Datos',
      hrvData: 'Datos de HRV',
      exerciseData: 'Datos de Ejercicio',
      moodData: 'Datos de Estado de Ánimo',
      temporalEvolution: 'Evolución Temporal',
      correlationAnalysis: 'Análisis de Correlación',
      exerciseVsHrv: 'Ejercicio vs HRV',
      intensityVsHrv: 'Intensidad de Ejercicio vs HRV',
      last3Months: 'Últimos 3 meses',
      lastMonth: 'Último mes',
      lastWeek: 'Última semana'
    },
    admin: {
      title: 'Administración',
      subtitle: 'Configuración del sistema y herramientas de administración',
      systemConfig: 'Configuración del Sistema',
      database: 'Base de Datos',
      userManagement: 'Gestión de Usuarios',
      roles: 'Roles',
      settings: 'Configuración',
      backup: 'Respaldo',
      export: 'Exportar',
      statistics: 'Estadísticas',
      tables: 'Tablas',
      records: 'Registros',
      tableExplorer: 'Explorador de Tablas',
      viewTables: 'Ver Tablas',
      refreshStats: 'Actualizar Estadísticas',
      exportData: 'Exportar Datos',
      createBackup: 'Crear Respaldo',
      description: 'Administra, respalda y supervisa la base de datos del sistema con herramientas profesionales diseñadas para el control completo de los datos.',
      databaseManagement: 'Administración de Base de Datos',
      dataManagement: 'Gestión de Datos',
      databaseDescription: 'Gestiona datos, realiza respaldos y supervisa el rendimiento de la base de datos con herramientas profesionales.',
      manageDatabase: 'Gestionar Base de Datos',
      access: 'Acceder',
      systemStatus: 'Estado del Sistema',
      realTimeMonitoring: 'Monitoreo en tiempo real',
      operational: 'Operativo',
      databaseSize: 'Tamaño de Base de Datos',
      uptime: 'Tiempo de Actividad',
      totalRecords: 'Registros Totales',
      systemUptime: 'Tiempo de Actividad del Sistema',
      userManagementDesc: 'Gestionar usuarios y permisos del sistema',
      advancedAnalyticsDesc: 'Análisis avanzado y reportes del sistema',
      configurationDesc: 'Configuración del sistema y preferencias',
      recordsLabel: 'Registros',
      usersLabel: 'Usuarios',
      uptimeLabel: 'Tiempo de Actividad',
      lastBackup: 'Último respaldo',
      tableStructure: 'Estructura y contenido de las tablas',
      tableContent: 'Contenido de las tablas',
      databaseOperations: 'Operaciones de base de datos',
      systemMetrics: 'Métricas del sistema'
    },
    users: {
      title: 'Gestión de Usuarios',
      subtitle: 'Administra perfiles, permisos y configuraciones del sistema',
      createUser: 'Crear Usuario',
      search: 'Buscar',
      username: 'Nombre de Usuario',
      email: 'Email',
      role: 'Rol',
      actions: 'Acciones',
      edit: 'Editar',
      delete: 'Eliminar',
      save: 'Guardar',
      cancel: 'Cancelar',
      create: 'Crear',
      update: 'Actualizar',
      userCreated: 'Usuario creado exitosamente',
      userUpdated: 'Usuario actualizado exitosamente',
      userDeleted: 'Usuario eliminado exitosamente',
      confirmDelete: '¿Estás seguro de que quieres eliminar este usuario?',
      admin: 'Administrador',
      doctor: 'Médico',
      user: 'Usuario',
      total: 'Total',
      active: 'Activos',
      status: 'Estado',
      gdpr: 'GDPR',
      activeStatus: 'Activo',
      yes: 'Sí',
      no: 'No',
      copyUUID: 'Copiar UUID',
      clearUUID: 'Limpiar UUID',
      editUser: 'Editar Usuario',
      createNewUser: 'Crear Nuevo Usuario',
      usernameLabel: 'Nombre de Usuario',
      passwordLabel: 'Contraseña',
      roleLabel: 'Rol',
      information: 'Información',
      userInfo: 'El usuario será creado con nombre de usuario y contraseña. Podrá acceder a la aplicación móvil usando estas credenciales.',
      saving: 'Guardando...',
      creating: 'Creando...',
      gdprConsent: 'Consentimiento GDPR',
      currentUUID: 'UUID Actual',
      noUUIDAssigned: 'Sin UUID asignado',
      userWillBeCreated: 'El usuario será creado con nombre de usuario y contraseña. Podrá acceder a la aplicación móvil usando estas credenciales.'
    },
    roles: {
      admin: 'admin',
      doctor: 'doctor',
      user: 'user',
      administrator: 'Administrador',
      physician: 'Médico',
      patient: 'Usuario'
    },
    common: {
      loading: 'Cargando...',
      error: 'Error',
      success: 'Éxito',
      warning: 'Advertencia',
      info: 'Información',
      confirm: 'Confirmar',
      cancel: 'Cancelar',
      save: 'Guardar',
      delete: 'Eliminar',
      edit: 'Editar',
      create: 'Crear',
      update: 'Actualizar',
      close: 'Cerrar',
      back: 'Atrás',
      next: 'Siguiente',
      previous: 'Anterior',
      search: 'Buscar',
      filter: 'Filtrar',
      clear: 'Limpiar',
      export: 'Exportar',
      import: 'Importar',
      download: 'Descargar',
      upload: 'Subir',
      refresh: 'Actualizar',
      retry: 'Reintentar',
      yes: 'Sí',
      no: 'No',
      ok: 'OK',
      found: 'encontrados',
      language: 'Idioma'
    },
    datepicker: {
      months: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
      days: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
      today: 'Hoy',
      close: 'Cerrar'
    }
  },
  en: {
    navigation: {
      dashboard: 'Dashboard',
      users: 'Users',
      data: 'Data',
      kubios: 'Kubios',
      analytics: 'Analytics',
      study: 'Study',
      admin: 'Admin',
      settings: 'Settings',
      database: 'Database',
      roles: 'Roles'
    },
    auth: {
      login: 'Login',
      logout: 'Logout',
      signIn: 'Sign In',
      signUp: 'Sign Up',
      email: 'Email',
      password: 'Password',
      username: 'Username',
      welcome: 'Welcome',
      createAccount: 'Create Account',
      joinPlatform: 'Join our health platform',
      accessAdmin: 'Access your admin panel',
      accessUser: 'Access your user panel',
      invalidCredentials: 'Invalid credentials',
      unexpectedError: 'Unexpected error during login',
      loggingIn: 'Logging in...',
      creatingAccount: 'Creating account...',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      noAccount: "Don't have an account? Sign up",
      register: 'Sign up',
      or: 'or',
      adminAccess: 'Admin access (with email)',
      appUserAccess: 'App user access',
      // Features del login
      realtimeMonitoring: 'Real-time Monitoring',
      realtimeMonitoringDesc: 'Continuous health data tracking with advanced technology',
      intelligentAnalysis: 'Intelligent Analysis',
      intelligentAnalysisDesc: 'Interactive charts and detailed statistics with AI',
      teamManagement: 'Team Management',
      teamManagementDesc: 'Complete administration of users and research teams',
      advancedSecurity: 'Advanced Security',
      advancedSecurityDesc: 'Data protection with medical-grade encryption'
    },
    dashboard: {
      title: 'Diabetes Tracker',
      subtitle: 'Intelligent health monitoring with cutting-edge technology. Manage users, analyze data and monitor heart rate variability metrics.',
      advancedControl: 'Advanced Control Panel',
      healthMonitoring: 'My Health Panel',
      manageUsers: 'Manage users, analyze data and monitor heart rate variability metrics.',
      analyzeData: 'View your data, analyze your progress and monitor your heart rate variability metrics.',
      monitorMetrics: 'Personal health monitoring with cutting-edge technology.',
      totalUsers: 'Total Users',
      totalRecords: 'Total Records',
      hrvUsers: 'HRV Users',
      systemAccuracy: 'System Accuracy',
      myRecords: 'My Records',
      myHrv: 'My HRV',
      myStatus: 'My Status',
      myProgress: 'My Progress',
      healthy: 'Healthy',
      active: 'Active',
      // Estados específicos
      activeStatus: 'Active',
      healthyStatus: 'Healthy',
      navigation: 'Navigation',
      premiumFeatures: 'Premium Features',
      systemStatus: 'System Status',
      uptime: 'Uptime',
      activeUsers: 'Active Users',
      userManagement: 'User Management',
      healthData: 'Health Data',
      advancedAnalytics: 'Advanced Analytics',
      hrvAnalysis: 'Kubios HRV',
      correlationStudy: 'Diabetes & Exercise Study',
      administration: 'Administration',
      access: 'Access',
      userManagementDescription: 'Manage profiles, permissions and system configurations',
      healthDataDescription: 'View and manage all user health data',
      advancedAnalyticsDescription: 'Advanced analysis with artificial intelligence and machine learning',
      hrvAnalysisDescription: 'Heart rate variability analysis with Kubios technology',
      correlationStudyDescription: 'Correlations between physical activity, HRV and glycemic control',
      administrationDescription: 'System configuration, database and user roles',
      generalSummary: 'General Summary',
      cuttingEdgeTechnology: 'Cutting-Edge Technology',
      intelligentMonitoring: 'Intelligent Monitoring',
      advancedPlatform: 'Advanced health tracking platform that combines data analysis, heart rate variability and wellness metrics for comprehensive management.',
      advancedSecurity: 'Advanced Security',
      endToEndEncryption: 'End-to-end encryption and medical-grade security protocols to protect users\' sensitive information.',
      moreInformation: 'More information',
      predictiveAnalysis: 'Predictive Analysis',
      machineLearningAlgorithms: 'Machine learning algorithms that identify patterns and predict health trends for early intervention.',
      exploreAI: 'Explore AI',
      continuousMonitoring: 'Continuous Monitoring',
      tracking24_7: '24/7 vital metrics tracking with intelligent alerts and personalized notifications for proactive care.',
      viewMetrics: 'View metrics',
      advancedSystem: 'Advanced System',
      logout: 'Logout',
      adminPanel: 'Administration Panel',
      adminDescription: 'Manage users, configure the system and monitor security. Advanced tools for total platform control.',
      createUser: 'Create User',
      searchUsers: 'Search users...',
      username: 'Username',
      email: 'Email',
      role: 'Role',
      actions: 'Actions',
      edit: 'Edit',
      delete: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      clearUUID: 'Clear UUID',
      confirmClearUUID: 'Are you sure you want to clear the UUID for this user?',
      userCreated: 'User created successfully',
      userUpdated: 'User updated successfully',
      userDeleted: 'User deleted successfully',
      uuidCleared: 'UUID cleared successfully',
      errorOccurred: 'An error occurred',
      admin: 'Administrator',
      doctor: 'Doctor',
      user: 'User',
      selectRole: 'Select role',
      roleUpdated: 'Role updated successfully',
      exportCSV: 'Export CSV',
      food: 'Meals',
      periods: 'Periods',
      mood: 'Mood',
      total: 'Total',
      type: 'Type',
      dose: 'Dose',
      quantity: 'Quantity',
      carbs: 'Carbs',
      intensity: 'Intensity',
      description: 'Description',
      symptoms: 'Symptoms',
      notes: 'Notes',
      value: 'Value',
      outOfRoutine: 'Out of routine',
      emotions: 'Emotions',
      yes: 'Yes',
      no: 'No',
      dataFilters: 'Data Filters',
      clearFilters: 'Clear filters',
      allUsers: 'All users',
      dataType: 'Data Type',
      allTypes: 'All types',
      timeRange: 'Time Range',
      allTime: 'All time',
      specificDate: 'Specific Date',
      selectDate: 'Select date',
      lastActivity: 'Last activity',
      insulinData: 'Insulin Data',
      records: 'records',
      showLess: 'Show less',
      viewAll: 'View all',
      records2: 'records',
      insulin: 'Insulin',
      meals: 'Meals',
      exercise: 'Exercise',
      loadingData: 'Loading data...',
      connectingServer: 'Connecting to server...',
      decryptingData: 'Decrypting data...',
      processingInfo: 'Processing information...',
      finalizing: 'Finalizing...',
      noDataFound: 'No data found',
      noRecordsForFilters: 'No records found for the selected filters.',
      analyzingStudyData: 'Analyzing Study Data',
      processingCorrelations: 'Processing correlations between diabetes, exercise and HRV...',
      // App Dashboard específico
      appDashboard: {
        myHealthPanel: 'My Health Panel',
        advancedControlPanel: 'Advanced Control Panel',
        myHealthData: 'My Health Data',
        myHrvAnalysis: 'My HRV Analysis',
        myStatistics: 'My Statistics',
        viewMyData: 'View my data',
        viewMyHrv: 'View my HRV',
        viewStatistics: 'View statistics',
        userManagement: 'User Management',
        healthData: 'Health Data',
        advancedAnalytics: 'Advanced Analytics',
        hrvAnalysis: 'HRV Analysis',
        correlationStudy: 'Correlation Study',
        administration: 'Administration',
        access: 'Access',
        total: 'Total',
        records: 'Records',
        users: 'Users',
        precision: 'Precision',
        study: 'Study',
        analysis: 'Analysis',
        panel: 'Panel',
        administrator: 'Administrator',
        physician: 'Physician',
        user: 'User',
        signOut: 'Sign Out'
      }
    },
    data: {
      title: 'Health Data',
      myData: 'My Health Data',
      allUsers: 'All users',
      user: 'User',
      dataType: 'Data Type',
      timeRange: 'Time Range',
      date: 'Date',
      clearFilters: 'Clear filters',
      exportCsv: 'Export CSV',
      insulin: 'Insulin',
      meals: 'Meals',
      exercise: 'Exercise',
      periods: 'Periods',
      mood: 'Mood',
      total: 'Total',
      all: 'All',
      last7Days: 'Last 7 days',
      last30Days: 'Last 30 days',
      last90Days: 'Last 90 days',
      insulinData: 'Insulin Data',
      foodData: 'Food Data',
      exerciseData: 'Exercise Data',
      periodData: 'Period Data',
      moodData: 'Mood Data',
      noData: 'No data available',
      loading: 'Loading...',
      error: 'Error loading data'
    },
    kubios: {
      title: 'Kubios HRV - Heart Rate Variability',
      subtitle: 'Advanced heart rate variability analysis',
      teamUsers: 'Team Users',
      selectUser: 'Select User',
      allUsers: 'All users',
      measurements: 'measurements',
      noResults: 'No HRV results found for this user',
      dateFrom: 'Date from',
      dateTo: 'Date to',
      updateUsers: 'Update Users',
      loadingUsers: 'Loading users...',
      errorLoadingUsers: 'ERROR LOADING USERS',
      hrvResults: 'HRV Results',
      noHrvResults: 'No HRV results available',
      showCharts: 'Show Charts',
      hideCharts: 'Hide Charts',
      // Métricas HRV
      metrics: {
        meanHr: 'Resting HR',
        rmssd: 'RMSSD',
        pnsIndex: 'PNS Index',
        snsIndex: 'SNS Index',
        physiologicalAge: 'Physiological Age',
        respiratoryRate: 'Respiratory Rate',
        stressIndex: 'Stress Index',
        quality: 'Quality',
        freqDomain: 'Frequency Domain',
        hfPower: 'HF Power',
        lfPower: 'LF Power',
        vlfPower: 'VLF Power',
        totalPower: 'Total Power',
        years: 'years'
      },
      // Niveles de readiness
      readinessLevels: {
        high: 'HIGH',
        normal: 'NORMAL',
        low: 'LOW',
        veryLow: 'VERY LOW'
      },
      // Gráficos HRV
      charts: {
        readinessEvolution: 'Readiness Evolution',
        rmssdEvolution: 'RMSSD Evolution',
        pnsSnsIndices: 'PNS vs SNS Indices',
        heartRateRest: 'Resting Heart Rate',
        frequencyDomain: 'Frequency Domain',
        averageReadiness: 'Average Readiness',
        averageRmssd: 'Average RMSSD',
        averageHeartRate: 'Average HR',
        lastRecords: 'Last {count} records',
        heartRateVariability: 'Heart rate variability',
        heartRate: 'Heart rate',
        date: 'Date',
        readinessPercentage: 'HRV Readiness (%)',
        rmssdMs: 'RMSSD (ms)',
        heartRateBpm: 'Heart Rate (bpm)',
        pnsSnsIndicesLabel: 'PNS/SNS Indices',
        heartRateLabel: 'Resting HR',
        spectralPower: 'Spectral Power (ms²)',
        hfPower: 'HF Power',
        lfPower: 'LF Power',
        vlfPower: 'VLF Power',
        pnsIndex: 'PNS Index',
        snsIndex: 'SNS Index',
        heartRateRestLabel: 'Resting HR'
      }
    },
    analytics: {
      title: 'Analytics and Statistics',
      subtitle: 'Detailed statistics and trend analysis',
      statistics: 'Statistics',
      trends: 'Trends',
      insights: 'Insights',
      recommendations: 'Recommendations',
      charts: 'Charts',
      data: 'Data',
      analysis: 'Analysis',
      generalStats: 'General Statistics',
      additionalStats: 'Additional Statistics',
      activityChart: 'General Activity Chart',
      dataTypeCharts: 'Charts by Data Type',
      insulinByType: 'Insulin by Type',
      insulinTypesUsed: 'Insulin Types Used',
      averageInsulinDose: 'Average Insulin Dose per Day',
      moodDistribution: 'Mood Distribution',
      temporalEvolution: 'Temporal Evolution',
      insulinEvolution: 'Insulin Records Evolution',
      mealEvolution: 'Meal Records Evolution',
      exerciseEvolution: 'Exercise Records Evolution',
      moodEvolution: 'Mood Records Evolution',
      insulinCorrelation: 'Insulin vs Carbohydrates Correlation',
      injections: 'injections',
      insulinType: 'Insulin Type',
      type: 'Type',
      records: 'records',
      moodLevel: 'Level',
      sessions: 'sessions',
      exercise: 'Exercise',
      mood: 'Mood',
      meals: 'Meals',
      insulin: 'Insulin',
      insulinInjections: 'Insulin Injections',
      registeredMeals: 'Registered Meals',
      exerciseSessions: 'Exercise Sessions',
      moodRecords: 'Mood Records',
      numberOfMeals: 'Number of Meals',
      date: 'Date',
      level: 'Level',
      injectionsPerDay: 'Injections per Day',
      dailyInsulinDoses: 'Daily Insulin Doses',
      insulinTypes: 'Insulin Types',
      mealTypes: 'Meal Types',
      moodLevels: 'Mood Levels',
      activityOverTime: 'Activity Over Time',
      dataDistribution: 'Data Distribution',
      temporalTrends: 'Temporal Trends',
      correlations: 'Correlations',
      generalActivityByDate: 'General Activity by Date',
      registeredMealTypes: 'Registered Meal Types',
      // Textos específicos de gráficos
      average: 'Average',
      units: 'units',
      carbohydrates: 'carbohydrates',
      registeredSessions: 'Registered sessions',
      cycleRecords: 'Cycle records',
      allTypes: 'All types',
      mostRecentDate: 'Most recent date',
      showsInsulinTypes: 'Shows which insulin types are used most frequently.',
      eachSector: 'Each sector',
      percentageUsage: 'Percentage usage of each type',
      showsMealTypes: 'Shows which meal types are registered most frequently.',
      xAxis: 'X Axis',
      yAxis: 'Y Axis',
      numberOfRecords: 'Number of Records',
      showsAverageInsulin: 'Shows the average amount of insulin administered each day.',
      numberOfInjections: 'Number of injections',
      showsMoodFrequency: 'Shows how frequent each mood level is (0=Very sad, 10=Very happy).',
      verySad: 'Very sad',
      veryHappy: 'Very happy',
      percentageRecords: 'Percentage of records with that level',
      showsInsulinInjections: 'Shows how many insulin injections were recorded each day.',
      showsMealRegistrations: 'Shows how many meals were recorded each day.',
      showsExerciseSessions: 'Shows how many exercise sessions were recorded each day.',
      numberOfSessions: 'Number of Sessions',
      showsMoodRecords: 'Shows how many mood records were made each day.',
      numberOfMoodRecords: 'Number of Records',
      foodTypes: 'Food Types',
      dates: 'Dates',
      quantity: 'Quantity',
      mealType: 'Meal Type',
      exerciseType: 'Exercise Type'
    },
    overview: {
      title: 'System Overview',
      subtitle: 'Overview and main metrics of the health tracking system',
      systemActive: 'System Active',
      totalUsersOverview: 'Total Users',
      totalRecordsOverview: 'Total Records',
      averageInsulin: 'Average Insulin',
      moodLevel: 'Mood Level',
      unitsPerRecord: 'units per record',
      generalAverage: 'general average',
      insulin: 'Insulin',
      meals: 'Meals',
      exercise: 'Exercise',
      periods: 'Periods',
      mood: 'Mood',
      systemAlerts: 'System Alerts',
      activityLast7Days: 'Activity of the Last 7 Days',
      mostActiveUsers: 'Most Active Users',
      recentActivity: 'Recent Activity',
      additionalSystemMetrics: 'Additional System Metrics',
      averageCarbs: 'Average carbs',
      recordsPerUser: 'Records per user',
      unknown: 'Unknown',
      activeUsers: 'Active users',
      lastActivity: 'Last system activity',
      systemOverview: 'System Overview',
      healthTrackingSystem: 'Overview and main metrics of the health tracking system',
      onlyActiveUsers: 'Only {active} of {total} users are active (last 7 days)',
      noRecentActivity: 'No recent activity in the system (more than 7 days)',
      dataDistributionByType: 'Data Distribution by Type',
      daysSinceLastActivity: 'Days since last activity',
      activeUsersRate: 'Active users rate'
    },
    study: {
      title: 'Correlation Study',
      subtitle: 'Analysis of correlations between exercise and HRV metrics',
      correlations: 'Correlations',
      insights: 'Study Insights',
      recommendations: 'Recommendations',
      dataSummary: 'Data Summary',
      hrvData: 'HRV Data',
      exerciseData: 'Exercise Data',
      moodData: 'Mood Data',
      temporalEvolution: 'Temporal Evolution',
      correlationAnalysis: 'Correlation Analysis',
      exerciseVsHrv: 'Exercise vs HRV',
      intensityVsHrv: 'Exercise Intensity vs HRV',
      last3Months: 'Last 3 months',
      lastMonth: 'Last month',
      lastWeek: 'Last week'
    },
    admin: {
      title: 'Administration',
      subtitle: 'System configuration and administration tools',
      systemConfig: 'System Configuration',
      database: 'Database',
      userManagement: 'User Management',
      roles: 'Roles',
      settings: 'Settings',
      backup: 'Backup',
      export: 'Export',
      statistics: 'Statistics',
      tables: 'Tables',
      records: 'Records',
      tableExplorer: 'Table Explorer',
      viewTables: 'View Tables',
      refreshStats: 'Refresh Statistics',
      exportData: 'Export Data',
      createBackup: 'Create Backup',
      description: 'Manage, backup and monitor the system database with professional tools designed for complete data control.',
      databaseManagement: 'Database Administration',
      dataManagement: 'Data Management',
      databaseDescription: 'Manage data, perform backups and monitor database performance with professional tools.',
      manageDatabase: 'Manage Database',
      access: 'Access',
      systemStatus: 'System Status',
      realTimeMonitoring: 'Real-time monitoring',
      operational: 'Operational',
      databaseSize: 'Database Size',
      uptime: 'Uptime',
      totalRecords: 'Total Records',
      systemUptime: 'System Uptime',
      userManagementDesc: 'Manage users and system permissions',
      advancedAnalyticsDesc: 'Advanced analysis and system reports',
      configurationDesc: 'System configuration and preferences',
      recordsLabel: 'Records',
      usersLabel: 'Users',
      uptimeLabel: 'Uptime',
      lastBackup: 'Last backup',
      tableStructure: 'Table structure and content',
      tableContent: 'Table content',
      databaseOperations: 'Database operations',
      systemMetrics: 'System metrics'
    },
    users: {
      title: 'User Management',
      subtitle: 'Manage profiles, permissions and system configurations',
      createUser: 'Create User',
      search: 'Search',
      username: 'Username',
      email: 'Email',
      role: 'Role',
      actions: 'Actions',
      edit: 'Edit',
      delete: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      create: 'Create',
      update: 'Update',
      userCreated: 'User created successfully',
      userUpdated: 'User updated successfully',
      userDeleted: 'User deleted successfully',
      confirmDelete: 'Are you sure you want to delete this user?',
      admin: 'Administrator',
      doctor: 'Doctor',
      user: 'User',
      total: 'Total',
      active: 'Active',
      status: 'Status',
      gdpr: 'GDPR',
      activeStatus: 'Active',
      yes: 'Yes',
      no: 'No',
      copyUUID: 'Copy UUID',
      clearUUID: 'Clear UUID',
      editUser: 'Edit User',
      createNewUser: 'Create New User',
      usernameLabel: 'Username',
      passwordLabel: 'Password',
      roleLabel: 'Role',
      information: 'Information',
      userInfo: 'The user will be created with username and password. They will be able to access the mobile app using these credentials.',
      saving: 'Saving...',
      creating: 'Creating...',
      gdprConsent: 'GDPR Consent',
      currentUUID: 'Current UUID',
      noUUIDAssigned: 'No UUID assigned',
      userWillBeCreated: 'The user will be created with username and password. They will be able to access the mobile app using these credentials.'
    },
    roles: {
      admin: 'admin',
      doctor: 'doctor',
      user: 'user',
      administrator: 'Administrator',
      physician: 'Doctor',
      patient: 'User'
    },
    common: {
      loading: 'Loading...',
      error: 'Error',
      success: 'Success',
      warning: 'Warning',
      info: 'Information',
      confirm: 'Confirm',
      cancel: 'Cancel',
      save: 'Save',
      delete: 'Delete',
      edit: 'Edit',
      create: 'Create',
      update: 'Update',
      close: 'Close',
      back: 'Back',
      next: 'Next',
      previous: 'Previous',
      search: 'Search',
      filter: 'Filter',
      clear: 'Clear',
      export: 'Export',
      import: 'Import',
      download: 'Download',
      upload: 'Upload',
      refresh: 'Refresh',
      retry: 'Retry',
      yes: 'Yes',
      no: 'No',
      ok: 'OK',
      found: 'found',
      language: 'Language'
    },
    datepicker: {
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      today: 'Today',
      close: 'Close'
    }
  }
}
