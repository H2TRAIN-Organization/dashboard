// Sistema de traducciones para la aplicación
export type Language = 'es' | 'en'

export interface Translations {
  // Navegación
  navigation: {
    dashboard: string
    users: string
    data: string
    kubios: string
    adminKubios: string
    privacy: string
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
    identifier: string
    identifierPlaceholder: string
    identifierHint: string
    unifiedAccess: string
    unifiedAccessDescription: string
    sessionMissingUsername: string
    signedInAs: string
    continueToDashboard: string
    accessDenied: string
    loginRequired: string
    verifyingSession: string
    insufficientPermissions: string
    noPermission: string
    needRole: string
    currentRole: string
    requiredPermission: string
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
    privacyCard: string
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
    system: string
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
    searchUser: string
    userSuggestions: string
    noUserMatches: string
    clearUserSelection: string
    rowsPerPage: string
    loadingUsers: string
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
    missingUsername: string
    queryTimeout: string
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
    // Resumen y estados del Kubios personal
    personal: {
      summaryTitle: string
      summaryDescription: string
      onlyOwnData: string
      latestMeasurement: string
      latestReadiness: string
      syncedAt: string
      staleWarning: string
      viewDetails: string
      statusUnlinked: string
      statusPending: string
      statusEmpty: string
      emptyRange: string
      loadError: string
      invalidResponse: string
      sessionExpired: string
      serviceUnavailable: string
      invalidDateRange: string
      clearFilters: string
      notAvailable: string
      dailyResult: string
      artefactLevel: string
      retry: string
      resultsInRange: string
      filterHint: string
    }
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
    others: string
    othersDetail: string
    averageInsulinDose: string
    averageDoseUnits: string
    averageDose: string
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
    timeEvolutionTitle: string
    glucoseEventsExcluded: string
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
    lowMoodAlert: string
    noDataTitle: string
    noDataDescription: string
    missingUsername: string
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
    pageTitle: string
    pageSubtitle: string
    refreshAnalysis: string
    filtersTitle: string
    analysisPeriod: string
    lastYear: string
    analyze: string
    exerciseMoodTitle: string
    exerciseMoodDescription: string
    insufficientCorrelation: string
    insightNoData: string
    insightsTitle: string
    recommendationsTitle: string
    dataSummaryTitle: string
    exerciseRecords: string
    mealRecords: string
    moodRecords: string
    insulinRecords: string
    advancedVisualTitle: string
    advancedVisualDescription: string
    errorTitle: string
    loadError: string
    retry: string
    kubiosNoticeTitle: string
    kubiosNoticeDescription: string
    viewKubiosMetrics: string
    kubiosPending: string
    noDataValue: string
    noStudyData: string
    noStudyDataDescription: string
    insightExerciseImproves: string
    insightIntenseAffects: string
    insightStable: string
    insightMoodPositive: string
    insightMoodAttention: string
    recommendationContinueExercise: string
    recommendationRelaxation: string
    recommendationVaryExercise: string
    recommendationMonitorWeekly: string
    recommendationMorningActivities: string
    recommendationLogDaily: string
    charts: {
      evolutionTitle: string
      evolutionDescription: string
      date: string
      values: string
      duration: string
      mood: string
      weeklyTitle: string
      weeklyDescription: string
      week: string
      averageValues: string
      intensityTitle: string
      intensityDescription: string
      sessions: string
      intensity: string
    }
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
    tableExplorerDescription: string
    exportDataDescription: string
    createBackupDescription: string
    refreshStatsDescription: string
    loadingTables: string
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
    kubios: {
      title: string
      description: string
      adminOnly: string
      participants: string
      participantFilter: string
      allParticipants: string
      searchParticipants: string
      participantsLoading: string
      participantsError: string
      retryParticipants: string
      tableCaption: string
      participant: string
      measuredAt: string
      syncedAt: string
      status: string
      pageMeasurements: string
      statusReady: string
      statusStale: string
      statusPending: string
      statusEmpty: string
      statusUnlinked: string
      pageStatusStale: string
      pageStatusPending: string
      pageStatusUnlinked: string
      empty: string
      unavailableCount: string
      loadError: string
      retry: string
      previous: string
      next: string
      page: string
      readiness: string
      sync: string
      syncBusy: string
      syncDone: string
      syncPartial: string
      syncNoConfig: string
      syncAuth: string
      syncCopy: string
      syncDeadline: string
      syncLocked: string
      syncThrottled: string
      syncError: string
    }
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
    noResults: string
    uuidCopied: string
    uuidCopyError: string
    createError: string
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
    menu: string
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
    notAvailable: string
    noData: string
    total: string
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
      adminKubios: 'Kubios de participantes',
      privacy: 'Política de privacidad',
      analytics: 'Analítica',
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
      identifier: 'Correo o nombre de participante',
      identifierPlaceholder: 'tu@email.com o tu_usuario',
      identifierHint: 'Puedes entrar con tu correo electrónico o con tu nombre de participante. El rol se toma siempre de la cuenta.',
      unifiedAccess: 'Acceso unificado',
      unifiedAccessDescription: 'Inicia sesión con la misma cuenta de siempre.',
      sessionMissingUsername: 'La sesión no incluye un nombre de participante para consultar los datos',
      signedInAs: 'Sesión iniciada como',
      continueToDashboard: 'Ir al inicio',
      accessDenied: 'Acceso denegado',
      loginRequired: 'Debes iniciar sesión para acceder a esta sección.',
      verifyingSession: 'Verificando autenticación...',
      insufficientPermissions: 'Permisos insuficientes',
      noPermission: 'No tienes permisos para acceder a esta sección.',
      needRole: 'Necesitas el rol {role} para acceder a esta sección.',
      currentRole: 'Rol actual',
      requiredPermission: 'Permiso requerido',
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
      healthMonitoring: 'Panel de Salud',
      manageUsers: 'Gestiona usuarios, analiza datos y supervisa métricas de variabilidad cardíaca.',
      analyzeData: 'Visualiza los datos, analiza el progreso y supervisa las métricas de variabilidad cardíaca.',
      monitorMetrics: 'Monitoreo personal de la salud con tecnología de vanguardia.',
      totalUsers: 'Usuarios Totales',
      totalRecords: 'Registros totales',
      hrvUsers: 'Usuarios HRV',
      systemAccuracy: 'Precisión Sistema',
      myRecords: 'Registros',
      myHrv: 'HRV',
      myStatus: 'Estado',
      myProgress: 'Progreso',
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
      privacyCard: 'Consulta el aviso de privacidad, tus derechos y el contacto del responsable',
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
      system: 'Sistema',
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
      searchUser: 'Buscar usuario...',
      userSuggestions: 'Sugerencias de usuarios',
      noUserMatches: 'Sin coincidencias',
      clearUserSelection: 'Quitar selección',
      rowsPerPage: 'Filas por página',
      loadingUsers: 'Cargando usuarios...',
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
      viewAll: 'Ver todos',
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
        myHealthPanel: 'Panel de Salud',
        advancedControlPanel: 'Panel de Control Avanzado',
        myHealthData: 'Datos de Salud',
        myHrvAnalysis: 'Análisis HRV',
        myStatistics: 'Estadísticas',
        viewMyData: 'Ver datos',
        viewMyHrv: 'Ver HRV',
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
      myData: 'Datos de Salud',
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
      error: 'Error al cargar los datos',
      missingUsername: 'La sesión no incluye un nombre de usuario para consultar los datos',
      queryTimeout: 'La consulta de datos tardó demasiado. Inténtalo de nuevo.'
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
      errorLoadingUsers: 'Error al cargar usuarios',
      hrvResults: 'Resultados HRV',
      noHrvResults: 'No hay resultados HRV disponibles',
      showCharts: 'Mostrar Gráficos',
      hideCharts: 'Ocultar Gráficos',
      personal: {
        summaryTitle: 'HRV (Kubios)',
        summaryDescription: 'Mediciones HRV sincronizadas. Solo el titular de la cuenta puede verlas.',
        onlyOwnData: 'Solo se muestran los datos propios de Kubios.',
        latestMeasurement: 'Última medición',
        latestReadiness: 'Readiness reciente',
        syncedAt: 'Última sincronización',
        staleWarning: 'Los datos mostrados son la última copia sincronizada y podrían no estar actualizados.',
        viewDetails: 'Ver Kubios',
        statusUnlinked: 'La cuenta todavía no está vinculada a Kubios. Cuando se complete la vinculación, las mediciones aparecerán aquí.',
        statusPending: 'La vinculación con Kubios está pendiente. Vuelve a intentarlo cuando se haya completado.',
        statusEmpty: 'Todavía no hay mediciones HRV sincronizadas en la cuenta.',
        emptyRange: 'No hay mediciones HRV en el rango de fechas seleccionado.',
        loadError: 'No se pudieron cargar los resultados HRV. Inténtalo de nuevo.',
        invalidResponse: 'El servicio devolvió una respuesta no válida.',
        sessionExpired: 'La sesión ha caducado. Inicia sesión de nuevo para consultar los resultados HRV.',
        serviceUnavailable: 'El servicio de Kubios no está disponible en este momento. Inténtalo de nuevo más tarde.',
        invalidDateRange: 'El rango de fechas no es válido. Revisa las fechas.',
        clearFilters: 'Limpiar filtros',
        notAvailable: 'N/D',
        dailyResult: 'Resultado diario',
        artefactLevel: 'Nivel de artefactos',
        retry: 'Reintentar',
        resultsInRange: 'Resultados en el rango seleccionado',
        filterHint: 'Filtra por fechas. Solo se consultan los datos propios.'
      },
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
      insights: 'Hallazgos',
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
      others: 'Otros',
      othersDetail: 'Tipos incluidos en «Otros»',
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
      timeEvolutionTitle: 'Evolución temporal',
      glucoseEventsExcluded:
        '{count} registros de eventos de glucemia (hipoglucemia/hiperglucemia) no son comidas y no se muestran en este gráfico.',
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
      averageDoseUnits: 'Dosis promedio (unidades)',
      averageDose: 'Dosis promedio',
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
      activeUsersRate: 'Tasa de usuarios activos',
      lowMoodAlert: 'Promedio de estado de ánimo bajo: {value}/10',
      noDataTitle: 'Sin datos para mostrar',
      noDataDescription: 'Todavía no hay registros de salud que resumir con los filtros actuales.',
      missingUsername: 'La sesión no incluye un nombre de usuario para consultar los datos'
    },
    study: {
      title: 'Estudio de Correlaciones',
      subtitle: 'Análisis de correlaciones entre ejercicio y métricas de HRV',
      correlations: 'Correlaciones',
      insights: 'Hallazgos',
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
      lastWeek: 'Última semana',
      pageTitle: 'Estudio Diabetes & Bienestar',
      pageSubtitle: 'Análisis de correlaciones entre actividad física, estado de ánimo y datos de diabetes',
      refreshAnalysis: 'Actualizar Análisis',
      filtersTitle: 'Filtros del Estudio',
      analysisPeriod: 'Período de Análisis',
      lastYear: 'Último año',
      analyze: 'Analizar',
      exerciseMoodTitle: 'Ejercicio ↔ Estado de Ánimo',
      exerciseMoodDescription: 'Impacto del ejercicio en el bienestar emocional',
      insufficientCorrelation: 'No hay datos suficientes para calcular esta correlación.',
      insightNoData: 'No hay datos suficientes para generar conclusiones del estudio',
      insightsTitle: 'Hallazgos del Estudio',
      recommendationsTitle: 'Recomendaciones',
      dataSummaryTitle: 'Resumen de Datos',
      exerciseRecords: 'Registros de Ejercicio',
      mealRecords: 'Registros de Comidas',
      moodRecords: 'Registros de Estado de Ánimo',
      insulinRecords: 'Registros de Insulina',
      advancedVisualTitle: 'Análisis Visual Avanzado',
      advancedVisualDescription: 'Gráficos especializados para el estudio de la relación entre diabetes, ejercicio y estado de ánimo',
      errorTitle: 'Error en el Estudio',
      loadError: 'Error al cargar los datos del estudio',
      retry: 'Reintentar',
      kubiosNoticeTitle: 'Kubios es personal',
      kubiosNoticeDescription: 'Las métricas de Kubios son personales y no se mezclan con los datos de este estudio colectivo. La vista personal de Kubios es el único lugar donde se pueden consultar las mediciones propias.',
      viewKubiosMetrics: 'Ver métricas de Kubios',
      kubiosPending: 'Cuando existan mediciones propias, se podrán consultar en la vista personal de Kubios.',
      noDataValue: 'Sin datos',
      noStudyData: 'No hay datos del estudio para el rango seleccionado',
      noStudyDataDescription: 'No se han cargado registros de ejercicio, comida, estado de ánimo o insulina para este período. Prueba otro rango de fechas.',
      insightExerciseImproves: '😊 El ejercicio regular mejora el estado de ánimo',
      insightIntenseAffects: '😔 El ejercicio intenso puede estar afectando el estado de ánimo',
      insightStable: '💪 Ejercicio y estado de ánimo tienen una relación estable',
      insightMoodPositive: '😊 Estado de ánimo general muy positivo',
      insightMoodAttention: '😔 El estado de ánimo general necesita atención',
      recommendationContinueExercise: '💪 Continuar con el ejercicio para mantener un buen estado de ánimo',
      recommendationRelaxation: '🧘‍♀️ Incorporar ejercicios de relajación y meditación',
      recommendationVaryExercise: '🎯 Variar los tipos de ejercicio para optimizar el bienestar',
      recommendationMonitorWeekly: '📊 Monitorizar patrones semanales para identificar tendencias',
      recommendationMorningActivities: '🌅 Incorporar actividades matutinas para mejorar el estado de ánimo',
      recommendationLogDaily: '📱 Registrar datos diariamente para mejorar el análisis',
      charts: {
        evolutionTitle: 'Evolución Temporal: Ejercicio y Estado de Ánimo',
        evolutionDescription: 'Análisis temporal de la actividad física y el bienestar emocional.',
        date: 'Fecha',
        values: 'Valores',
        duration: 'Duración del Ejercicio',
        mood: 'Estado de Ánimo',
        weeklyTitle: 'Análisis Semanal: Actividad y Estado de Ánimo',
        weeklyDescription: 'Análisis semanal con las tendencias promedio de actividad física y estado de ánimo.',
        week: 'Semana',
        averageValues: 'Valores Promedio',
        intensityTitle: 'Distribución de Intensidades de Ejercicio',
        intensityDescription: 'Distribución de las intensidades de ejercicio registradas durante el período de estudio.',
        sessions: 'sesiones',
        intensity: 'Intensidad'
      }
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
      tableExplorerDescription: 'Explorar y visualizar todas las tablas de la base de datos',
      exportDataDescription: 'Exportar datos en formato JSON o CSV',
      createBackupDescription: 'Crear un respaldo completo de la base de datos',
      refreshStatsDescription: 'Actualizar estadísticas y métricas del sistema',
      loadingTables: 'Cargando tablas...',
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
      systemMetrics: 'Métricas del sistema',
      kubios: {
        title: 'Kubios (Equipo)',
        description: 'Consulta las mediciones Kubios de todos los participantes. Acceso exclusivo para administradores.',
        adminOnly: 'Solo administradores',
        participants: 'Participantes',
        participantFilter: 'Filtrar por participante',
        allParticipants: 'Todos los participantes',
        searchParticipants: 'Buscar participante...',
        participantsLoading: 'Cargando participantes...',
        participantsError: 'No se pudieron cargar los participantes.',
        retryParticipants: 'Reintentar participantes',
        tableCaption: 'Mediciones Kubios de los participantes',
        participant: 'Participante',
        measuredAt: 'Medición',
        syncedAt: 'Sincronización',
        status: 'Estado',
        pageMeasurements: 'Mediciones en esta página',
        statusReady: 'Actualizado',
        statusStale: 'Desactualizado',
        statusPending: 'Sincronización pendiente',
        statusEmpty: 'Sin mediciones',
        statusUnlinked: 'Sin vincular',
        pageStatusStale: 'Algunas mediciones son la última copia sincronizada y podrían no estar actualizadas.',
        pageStatusPending: 'La sincronización de Kubios está pendiente; las mediciones podrían no estar disponibles todavía.',
        pageStatusUnlinked: 'Hay participantes sin vincular a Kubios.',
        empty: 'No hay mediciones Kubios para la selección actual.',
        unavailableCount: 'Algunos historiales de participantes vinculados no se pudieron leer.',
        loadError: 'No se pudieron cargar las mediciones de Kubios.',
        retry: 'Reintentar',
        previous: 'Anterior',
        next: 'Siguiente',
        page: 'Página',
        readiness: 'Readiness',
        sync: 'Sincronizar copia',
        syncBusy: 'Sincronizando con Kubios…',
        syncDone: 'Copia sincronizada con Kubios. Los datos mostrados ya son la copia más reciente.',
        syncPartial: 'La sincronización no se completó del todo; la copia puede seguir desactualizada.',
        syncNoConfig: 'Este despliegue no tiene la configuración de Kubios; no se puede sincronizar.',
        syncAuth: 'No se pudo autenticar en Kubios con la configuración del despliegue; la copia no cambió.',
        syncCopy: 'Kubios no entregó los resultados de este participante; la copia no cambió.',
        syncDeadline: 'El refresco agotó su plazo antes de terminar; la copia puede seguir desactualizada.',
        syncLocked: 'Otra sincronización de Kubios tiene el turno ahora mismo. Inténtalo de nuevo en unos segundos.',
        syncThrottled: 'Kubios limitó la tasa de peticiones. Espera el plazo indicado antes de volver a sincronizar.',
        syncError: 'Fallo interno del refresco en este despliegue; la copia no cambió. Vuelve a intentarlo y, si persiste, revisa el despliegue.',
      }
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
      userWillBeCreated: 'El usuario será creado con nombre de usuario y contraseña. Podrá acceder a la aplicación móvil usando estas credenciales.',
      noResults: 'No se encontraron usuarios',
      uuidCopied: 'UUID copiado al portapapeles',
      uuidCopyError: 'Error al copiar al portapapeles',
      createError: 'Error creando usuario: {error}'
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
      menu: 'Abrir menú de navegación',
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
      language: 'Idioma',
      notAvailable: 'No disponible',
      noData: 'Sin datos',
      total: 'Total'
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
      adminKubios: 'Participant Kubios data',
      privacy: 'Privacy policy',
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
      identifier: 'Email or participant name',
      identifierPlaceholder: 'you@email.com or your_username',
      identifierHint: 'Sign in with your email address or your participant name. The role always comes from the account.',
      unifiedAccess: 'Unified access',
      unifiedAccessDescription: 'Sign in with the same account as always.',
      sessionMissingUsername: 'The session does not include a participant name to query data',
      signedInAs: 'Signed in as',
      continueToDashboard: 'Go to home',
      accessDenied: 'Access denied',
      loginRequired: 'You must sign in to access this section.',
      verifyingSession: 'Verifying authentication...',
      insufficientPermissions: 'Insufficient permissions',
      noPermission: 'You do not have permission to access this section.',
      needRole: 'You need the {role} role to access this section.',
      currentRole: 'Current role',
      requiredPermission: 'Required permission',
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
      healthMonitoring: 'Health Panel',
      manageUsers: 'Manage users, analyze data and monitor heart rate variability metrics.',
      analyzeData: 'View data, analyze progress and monitor heart rate variability metrics.',
      monitorMetrics: 'Personal health monitoring with cutting-edge technology.',
      totalUsers: 'Total Users',
      totalRecords: 'Total Records',
      hrvUsers: 'HRV Users',
      systemAccuracy: 'System Accuracy',
      myRecords: 'Records',
      myHrv: 'HRV',
      myStatus: 'Status',
      myProgress: 'Progress',
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
      privacyCard: 'Read the privacy notice, your rights and the controller contact',
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
      system: 'System',
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
      searchUser: 'Search user...',
      userSuggestions: 'User suggestions',
      noUserMatches: 'No matches',
      clearUserSelection: 'Clear selection',
      rowsPerPage: 'Rows per page',
      loadingUsers: 'Loading users...',
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
        myHealthPanel: 'Health Panel',
        advancedControlPanel: 'Advanced Control Panel',
        myHealthData: 'Health Data',
        myHrvAnalysis: 'HRV Analysis',
        myStatistics: 'Statistics',
        viewMyData: 'View data',
        viewMyHrv: 'View HRV',
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
      myData: 'Health Data',
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
      error: 'Error loading data',
      missingUsername: 'The session does not include a participant name to query data',
      queryTimeout: 'The data query took too long. Please try again.'
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
      errorLoadingUsers: 'Error loading users',
      hrvResults: 'HRV Results',
      noHrvResults: 'No HRV results available',
      showCharts: 'Show Charts',
      hideCharts: 'Hide Charts',
      personal: {
        summaryTitle: 'HRV (Kubios)',
        summaryDescription: 'Synchronized HRV measurements. Only the account holder can see them.',
        onlyOwnData: 'Only own Kubios data is shown.',
        latestMeasurement: 'Latest measurement',
        latestReadiness: 'Recent readiness',
        syncedAt: 'Last sync',
        staleWarning: 'The data shown is the last synchronized copy and may be out of date.',
        viewDetails: 'View Kubios',
        statusUnlinked: 'The account is not linked to Kubios yet. Measurements will appear here once linking is complete.',
        statusPending: 'Kubios linking is pending. Try again once it has completed.',
        statusEmpty: 'There are no synchronized HRV measurements in the account yet.',
        emptyRange: 'There are no HRV measurements in the selected date range.',
        loadError: 'The HRV results could not be loaded. Please try again.',
        invalidResponse: 'The service returned an invalid response.',
        sessionExpired: 'The session has expired. Sign in again to view the HRV results.',
        serviceUnavailable: 'The Kubios service is unavailable right now. Please try again later.',
        invalidDateRange: 'The date range is invalid. Check the dates.',
        clearFilters: 'Clear filters',
        notAvailable: 'N/A',
        dailyResult: 'Daily result',
        artefactLevel: 'Artefact level',
        retry: 'Retry',
        resultsInRange: 'Results in the selected range',
        filterHint: 'Filter by date. Only own data is queried.'
      },
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
      others: 'Others',
      othersDetail: 'Types included in "Others"',
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
      timeEvolutionTitle: 'Time Evolution',
      glucoseEventsExcluded:
        '{count} glucose event records (hypoglycemia/hyperglycemia) are not meals and are not shown in this chart.',
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
      averageDoseUnits: 'Average dose (units)',
      averageDose: 'Average dose',
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
      activeUsersRate: 'Active users rate',
      lowMoodAlert: 'Low average mood: {value}/10',
      noDataTitle: 'No data to show',
      noDataDescription: 'There are no health records to summarize with the current filters yet.',
      missingUsername: 'The session does not include a participant name to query data'
    },
    study: {
      title: 'Correlation Study',
      subtitle: 'Analysis of correlations between exercise and HRV metrics',
      correlations: 'Correlations',
      insights: 'Findings',
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
      lastWeek: 'Last week',
      pageTitle: 'Diabetes & Wellbeing Study',
      pageSubtitle: 'Analysis of correlations between physical activity, mood and diabetes data',
      refreshAnalysis: 'Refresh Analysis',
      filtersTitle: 'Study Filters',
      analysisPeriod: 'Analysis Period',
      lastYear: 'Last year',
      analyze: 'Analyze',
      exerciseMoodTitle: 'Exercise ↔ Mood',
      exerciseMoodDescription: 'Impact of exercise on emotional wellbeing',
      insufficientCorrelation: 'There is not enough data to calculate this correlation.',
      insightNoData: 'There is not enough data to generate study conclusions',
      insightsTitle: 'Study Findings',
      recommendationsTitle: 'Recommendations',
      dataSummaryTitle: 'Data Summary',
      exerciseRecords: 'Exercise Records',
      mealRecords: 'Meal Records',
      moodRecords: 'Mood Records',
      insulinRecords: 'Insulin Records',
      advancedVisualTitle: 'Advanced Visual Analysis',
      advancedVisualDescription: 'Specialized charts for the relationship between diabetes, exercise and mood',
      errorTitle: 'Study error',
      loadError: 'Error loading study data',
      retry: 'Retry',
      kubiosNoticeTitle: 'Kubios is personal',
      kubiosNoticeDescription: 'Kubios metrics are personal and are not mixed with the data of this collective study. The personal Kubios view is the only place where own measurements can be consulted.',
      viewKubiosMetrics: 'View Kubios metrics',
      kubiosPending: 'When own measurements exist, they can be consulted in the personal Kubios view.',
      noDataValue: 'No data',
      noStudyData: 'No study data for the selected range',
      noStudyDataDescription: 'No exercise, meal, mood or insulin records were loaded for this period. Try another date range.',
      insightExerciseImproves: '😊 Regular exercise improves mood',
      insightIntenseAffects: '😔 Intense exercise may be affecting mood',
      insightStable: '💪 Exercise and mood have a stable relationship',
      insightMoodPositive: '😊 Overall mood is very positive',
      insightMoodAttention: '😔 Overall mood needs attention',
      recommendationContinueExercise: '💪 Keep exercising to maintain a good mood',
      recommendationRelaxation: '🧘‍♀️ Add relaxation and meditation exercises',
      recommendationVaryExercise: '🎯 Vary exercise types to optimize wellbeing',
      recommendationMonitorWeekly: '📊 Monitor weekly patterns to identify trends',
      recommendationMorningActivities: '🌅 Add morning activities to improve mood',
      recommendationLogDaily: '📱 Log data daily for better analysis',
      charts: {
        evolutionTitle: 'Temporal Evolution: Exercise and Mood',
        evolutionDescription: 'Temporal analysis of physical activity and emotional wellbeing.',
        date: 'Date',
        values: 'Values',
        duration: 'Exercise Duration',
        mood: 'Mood',
        weeklyTitle: 'Weekly Analysis: Activity and Mood',
        weeklyDescription: 'Weekly analysis showing average physical activity and mood trends.',
        week: 'Week',
        averageValues: 'Average Values',
        intensityTitle: 'Exercise Intensity Distribution',
        intensityDescription: 'Distribution of exercise intensities recorded during the study period.',
        sessions: 'sessions',
        intensity: 'Intensity'
      }
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
      tableExplorerDescription: 'Browse and view all database tables',
      exportDataDescription: 'Export data in JSON or CSV format',
      createBackupDescription: 'Create a complete database backup',
      refreshStatsDescription: 'Refresh system statistics and metrics',
      loadingTables: 'Loading tables...',
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
      systemMetrics: 'System metrics',
      kubios: {
        title: 'Kubios (Team)',
        description: 'Browse Kubios measurements for every participant. Administrator access only.',
        adminOnly: 'Administrators only',
        participants: 'Participants',
        participantFilter: 'Filter by participant',
        allParticipants: 'All participants',
        searchParticipants: 'Search participant...',
        participantsLoading: 'Loading participants...',
        participantsError: 'The participants could not be loaded.',
        retryParticipants: 'Retry participants',
        tableCaption: 'Kubios measurements for participants',
        participant: 'Participant',
        measuredAt: 'Measurement',
        syncedAt: 'Synchronization',
        status: 'Status',
        pageMeasurements: 'Measurements on this page',
        statusReady: 'Up to date',
        statusStale: 'Out of date',
        statusPending: 'Sync pending',
        statusEmpty: 'No measurements',
        statusUnlinked: 'Not linked',
        pageStatusStale: 'Some measurements are the last synchronized copy and may be out of date.',
        pageStatusPending: 'Kubios synchronization is pending; measurements may not be available yet.',
        pageStatusUnlinked: 'Some participants are not linked to Kubios.',
        empty: 'There are no Kubios measurements for the current selection.',
        unavailableCount: 'Some linked participant histories could not be read.',
        loadError: 'The Kubios measurements could not be loaded.',
        retry: 'Retry',
        previous: 'Previous',
        next: 'Next',
        page: 'Page',
        readiness: 'Readiness',
        sync: 'Synchronize copy',
        syncBusy: 'Synchronizing with Kubios…',
        syncDone: 'Copy synchronized with Kubios. The data shown is now the freshest copy.',
        syncPartial: 'The synchronization did not fully complete; the copy may still be outdated.',
        syncNoConfig: 'This deployment has no Kubios configuration; synchronization is not possible.',
        syncAuth: 'Kubios authentication failed with this deployment configuration; the copy did not change.',
        syncCopy: 'Kubios did not deliver this participant results; the copy did not change.',
        syncDeadline: 'The refresh ran out of time before finishing; the copy may still be outdated.',
        syncLocked: 'Another Kubios synchronization holds the turn right now. Try again in a few seconds.',
        syncThrottled: 'Kubios rate limited the requests. Wait for the indicated deadline before syncing again.',
        syncError: 'Internal refresh failure in this deployment; the copy did not change. Try again and check the deployment if it persists.',
      }
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
      userWillBeCreated: 'The user will be created with username and password. They will be able to access the mobile app using these credentials.',
      noResults: 'No users found',
      uuidCopied: 'UUID copied to clipboard',
      uuidCopyError: 'Error copying to clipboard',
      createError: 'Error creating user: {error}'
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
      menu: 'Open navigation menu',
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
      language: 'Language',
      notAvailable: 'Not available',
      noData: 'No data',
      total: 'Total'
    },
    datepicker: {
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      today: 'Today',
      close: 'Close'
    }
  }
}
