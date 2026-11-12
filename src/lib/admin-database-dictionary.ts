export const databaseDictionary = {
  es: {
    title: "Administración de datos", description: "Consulta y descarga datos saneados de usuarios, salud y Kubios vinculado.",
    explorer: "Explorar tablas", exports: "Exportar datos", copy: "Copia lógica cifrada", refresh: "Actualizar estadísticas",
    loading: "Cargando…", busy: "Preparando descarga…", table: "Tabla", records: "registros", available: "tablas disponibles",
    complete: "Consulta completa", partial: "Consulta parcial: hay tablas no disponibles", failed: "No se pudo consultar ninguna tabla", unknown: "Sin consulta confirmada", observed: "Última consulta", failedAttempt: "La actualización falló. Se conservan los últimos resultados confirmados.",
    browse: "Consultar", pageSize: "Filas por página", previous: "Anterior", next: "Siguiente", empty: "No hay registros.", unavailable: "No disponible", showing: "Mostrando", of: "de",
    exportDescription: "Descarga todos los registros de la tabla seleccionada, ordenados por clave primaria. CSV neutraliza fórmulas de hoja de cálculo.",
    copyDescription: "Incluye usuarios, las seis tablas de salud y Kubios vinculado con un manifiesto de recuentos. Excluye sesiones, contraseñas, tokens, claves y esquema. Es una copia lógica saneada, no un backup completo de PostgreSQL. La lectura paginada comprueba recuentos, pero no es una instantánea transaccional.",
    password: "Contraseña de cifrado (mínimo 12 caracteres)", confirm: "Repetir contraseña", mismatch: "Las contraseñas deben coincidir y tener al menos 12 caracteres.", recovery: "Guarda la contraseña de forma segura. No se almacena ni se envía al servidor: el navegador deriva la clave y solo la clave viaja en la petición. Se necesita la contraseña para descifrar el archivo. Si cualquier lectura falla no se genera una copia parcial.", downloadCopy: "Descargar copia cifrada", success: "Descarga preparada.",
  },
  en: {
    title: "Data administration", description: "Browse and download sanitized user, health and linked Kubios data.",
    explorer: "Explore tables", exports: "Export data", copy: "Encrypted logical copy", refresh: "Refresh statistics",
    loading: "Loading…", busy: "Preparing download…", table: "Table", records: "records", available: "tables available",
    complete: "Complete query", partial: "Partial query: some tables are unavailable", failed: "No table could be queried", unknown: "No confirmed query", observed: "Last query", failedAttempt: "Refresh failed. The last confirmed results remain visible.",
    browse: "Browse", pageSize: "Rows per page", previous: "Previous", next: "Next", empty: "No records.", unavailable: "Unavailable", showing: "Showing", of: "of",
    exportDescription: "Download every record in the selected table, ordered by primary key. CSV neutralizes spreadsheet formulas.",
    copyDescription: "Includes users, the six health tables and linked Kubios with a count manifest. Excludes sessions, passwords, tokens, keys and schema. This is a sanitized logical copy, not a complete PostgreSQL backup. Paged reads check counts but are not a transactional snapshot.",
    password: "Encryption password (at least 12 characters)", confirm: "Repeat password", mismatch: "Passwords must match and contain at least 12 characters.", recovery: "Keep the password safely. It is never stored and never sent to the server: the browser derives the key and only the key travels in the request. The password is required to decrypt the file. If any read fails, no partial copy is generated.", downloadCopy: "Download encrypted copy", success: "Download prepared.",
  },
};
