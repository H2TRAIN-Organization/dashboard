# Administración, Estudio y privacidad

Implementación local en `codex/feature/admin-study-privacy`, basada en
`007a983`. Validación local, sin despliegue, migraciones remotas ni cambios de datos reales.
Se conserva `progress.txt` preexistente y no se añaden dependencias.

## Comportamiento

- Kubios administrativo separado de los endpoints personales: participantes,
  búsqueda por nombre/ID, paginación, fechas/estado, detalle, gráfica y CSV.
  Un admin sin vínculo propio puede consultar participantes; doctor no obtiene
  acceso colectivo a Kubios. Se leen los snapshots cifrados existentes.
- La lista habitual solo descifra la página elegida y el detalle su snapshot.
  Los filtros de estado/fechas y la copia completa recorren la caché para
  calcular resultados completos; errores o páginas repetidas fallan cerradas.
- Estudio usa periodos tipados, incluido `365d`. Agrega por participante y día
  UTC, deriva minutos de las horas de ejercicio, reconoce intensidades
  textuales/numéricas y mantiene ausencias. Las asociaciones muestran muestra
  y participantes; no se presentan como recomendaciones ni efectos causales.
  La disponibilidad de Kubios es explícita: completa, parcial, no disponible
  o restringida para doctor.
- Base de datos permite explorar páginas ordenadas, exportar CSV/JSON
  completos, descargar una copia lógica cifrada y actualizar estadísticas.
  No se ejecuta SQL arbitrario. La copia incluye usuarios, salud y Kubios
  vinculado; excluye sesiones, contraseñas/hashes, tokens y claves.
- Cada sesión debe reconocer el primer aviso antes de consultar datos.
  Después aparece una barra inferior; aceptarla la oculta. Rechazar desde
  esa barra exige confirmar; cancelar conserva la sesión. El rechazo registra
  la decisión y revoca solo la sesión afectada, de forma transaccional.
  Recargas conservan la etapa; una sesión nueva vuelve a empezar.
- `/privacy` es pública y enlazada desde la navegación. La política ES/EN
  permanece marcada como borrador. Responsable y contacto facilitados:
  ULPGC y `htrain@proton.me`; finalidad de consulta/tratamiento de datos médicos,
  consentimiento explícito externo y conservación prevista de un año desde
  la recogida. Los avisos son reconocimientos para acceder, no sustituyen ni
  modifican el consentimiento externo o `GDPRConsent`.

## Contratos y migraciones

OpenAPI documenta estado/decisión de privacidad, Kubios administrativo,
Estudio, descargas y offset de tablas. Los endpoints privados exigen el
primer reconocimiento en servidor, incluidos los lectores personales Kubios.
Se conservan CSRF y `Cache-Control: private, no-store`.

Las dos migraciones nuevas están preparadas y probadas localmente:

1. `supabase/migrations/20261104120000_kubios_admin_read.sql`:
   RPC de vínculos/lista paginada/detalle, restringidas a `service_role`.
2. `supabase/migrations/20261104121000_session_privacy.sql`:
   etapas/versiones por sesión y auditoría con transición atómica, bloqueo,
   idempotencia y rechazo terminal.

No se han aplicado a la base remota. Antes de utilizar esta versión con ella
deben aplicarse sobre el esquema de autenticación/Kubios existente mediante
el procedimiento operativo autorizado. Sin el esquema requerido, los accesos
fallan cerrados; no hay fallback que autorice por datos del navegador.

## Comprobaciones reales

Evidencias locales en
`C:/Users/Jia_admin/AppData/Local/Temp/codex-admin-study-privacy/`.

| Comprobación | Resultado / evidencia |
|---|---|
| TypeScript servidor/app, lint, capas y Vitest | `npm run check`: 365 pasadas, 2 live opt-in omitidas; `check-release.log` |
| Build Next | Build de producción correcto, BUILD_ID `W6MftBrmW73dJvx2_RjbZ`; `lasso-validator-build.log` |
| Regresión Kubios | 290 pasadas, 1 omitida por entorno específico; `kubios-regression.log` |
| SQL privacidad, PostgreSQL aislado | Migración repetida, orden, idempotencia/conflicto, versión, rollback, rechazo concurrente terminal, otras sesiones/consentimiento intactos y grants; `sql-privacy.log` |
| SQL Kubios, PostgreSQL aislado | Migración repetida, 205 usuarios, keyset/páginas, búsqueda/detalle y permisos; `sql-kubios.log` |
| API existente | 15 pasadas contra backend y dependencia HTTP simulada; `api-existing.log` |
| Regresión DR | 3 pasadas, 1.011 registros y paginación de usuarios; `api-regression.log` |
| API nueva | 4 pasadas sobre el código integrado final: gate de todas las familias privadas, rechazo, Kubios/Estudio y descarga completa; `api-new-final.log` |
| Postman | 32 solicitudes y 68 aserciones sin fallos; `postman.log`; lint sin errores ni advertencias |
| Navegador DR | 21 pasadas con API simulada por página; `browser-regression.log` |
| Navegador privacidad | 6 pasadas escritorio/móvil, modal, barra inferior, confirmación y persistencia; capturas `test-results/privacy-*.png` |
| Navegador aceptación | 9 pasadas: 8 con backend real/Supabase simulado y 1 representación de fixture local; `frontend-real-final.log` |

Los escenarios de cifrado comprueban recuperación offline, contraseña
incorrecta y manipulación. La exportación se comprueba por encima de 1.000
filas y falla explícitamente ante lecturas incompletas.

Postman CLI es `1.74.0`: la colección y su lint funcionan; el comando
`postman status` no existe en esa versión (`postman-status.log`). No se
ha instalado ni actualizado software para sustituir esa comprobación.

## Cierre con Lasso

Tras la petición de continuación, el cierre se delegó mediante el arnés
`C:/Users/Jia_admin/Desktop/lasso` a los roles `implementer`, `validator` y
`security-reviewer`, con contextos nuevos y propiedad explícita. Las tres
sesiones usan `opencode-go/deepseek-v4.1-flash#max`, comprobado mediante
la API local de OpenCode y registrado en `lasso-sessions.json`.

El implementador corrigió tres selectores de las pruebas reales y verificó
las nueve pruebas de aceptación juntas; no necesitó cambiar la lógica de
aplicación. Se corrigió también el desbordamiento móvil de la navegación
administrativa. La captura actual es `test-results/admin-database-mobile-real.png`.

La validación independiente de Lasso (`lasso-validator.md`) no encontró
defectos confirmados en fuente y ejecutó por su cuenta typecheck, lint, capas,
365 tests y build. Comprobó tres flujos de privacidad y el parche de navegación
móvil: ancho del documento igual a 390 y 320 píxeles, respectivamente, sin
desbordamiento. La suite completa de nueve recorridos de aceptación fue
ejecutada por el implementador; el validador distingue esa evidencia de la suya.

La revisión independiente de seguridad (`lasso-security.md`) ejecutó 45 tests
dirigidos y los dos runners SQL aislados. No confirmó vulnerabilidades de
autorización, confidencialidad, privacidad, CSRF o cifrado. Registró R-01:
una copia lógica paginada puede omitir registros si hay borrados e inserciones
concurrentes que mantengan el total. Se conserva la limitación explícita de
copia no transaccional en UI, manifiesto y documentación. Para usarla en
recuperación debe generarse en una ventana sin escrituras; no sustituye un
respaldo transaccional de la base. No se declara solucionada esa limitación.

## Límites de la entrega

- Los tests HTTP usan una dependencia Supabase simulada y los SQL una base
  PostgreSQL desechable. No acreditan producción, RLS remota, un login real
  de participante ni disponibilidad real de proveedores.
- La política es un borrador: deben verificarse condiciones de proveedores,
  transferencias internacionales y gestión efectiva de conservación antes
  de considerarla definitiva. Referencia de criterios:
  [AEPD sobre consentimiento](https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/5-bases-legitimadoras-del-tratamiento/FAQ-0211-segun-el-rgpd-como-debe-solicitarse-el-consentimiento-de-los-interesados-para-tratar-sus-datos-personales).
- No se añade borrado automático retroactivo ni se detienen importaciones al
  rechazar un aviso: esa decisión solo cierra la sesión, según lo acordado.
- La copia lógica es una lectura paginada saneada, completa en memoria, sin
  instantánea transaccional ni restauración de esquema/Auth. Sus límites y
  recuperación se describen en `admin-database-logical-copy.md`.
