# Evidencia de integración Kubios

## Base que se publicará

El 2026-11-03 se comprobó en Git y en la pantalla de despliegues de Vercel
que producción usa `codex/release/0.2.0`, commit `fbb3adc`. La integración se
prepara sobre esa base en `codex/kubios-integration`. El checkout antiguo de
`main` estaba 59 commits por detrás y se conserva como referencia local.

La base de producción pasó `npm run check`: tipos de servidor y aplicación,
lint, dirección de dependencias y 177 pruebas. Esto es evidencia de la base,
no sustituye las comprobaciones finales después de integrar Kubios.

## Acceso y esquema Supabase: lectura real

La clave de servicio existente fue aceptada por PostgREST. Consultas con
`limit=0` y el perfil explícito `public` devolvieron HTTP 200 sin descargar
filas. La API tiene `api` como perfil predeterminado; los clientes del servidor
deben seleccionar `public` explícitamente.

Se ejecutaron únicamente sentencias SELECT de metadatos en el SQL Editor del
proyecto utilizado por el dashboard. Resultado observado el 2026-11-03:

| Comprobación | Resultado |
|---|---|
| Tipo de `public.users.UserID` | `integer` |
| Esquema `kubios_private` | No existe |
| Funciones públicas `kubios_*` | 0 |
| Catálogo de Cron, Vault y extensión `pg_net` | Disponibles |
| RLS en users y las cinco tablas de salud | Activado |
| SELECT de tabla para anon/authenticated en esas seis tablas | Denegado |
| Grants de columna para PUBLIC/anon/authenticated | 0 |
| SELECT de service_role | Permitido |

No se aplicó DDL, no se leyeron registros clínicos ni se activó ningún job.
`schema-audit.sql` contiene las consultas de metadatos para repetir la auditoría.
Las migraciones de privacidad ya presentes en producción se conservan; no se
porta la antigua propuesta que concedía SELECT directo a authenticated.

## Contrato real de Kubios: una cuenta autorizada

Una pasada sin reintentos comprobó autenticación Cognito, perfil propio,
miembros del equipo autorizado y resultados de la única cuenta indicada por
el humano. Las tres lecturas de datos devolvieron HTTP 200 y se encontraron
dos resultados. No se consultaron resultados del resto de los miembros.

Ambas filas tenían `measured_timestamp` válido y métricas dentro de `result`.
Se confirmaron los nombres canónicos usados por las vistas y `freq_domain`.
El verificador exigió formato UUID para el `team_user_id` de la cuenta
objetivo antes de consultar sus resultados; esa comprobación pasó. No se
generaliza esa observación al formato de todos los miembros futuros.
No se guardaron cuerpos de respuesta, valores HRV, tokens ni identificadores
reales en archivos de evidencia.

El cifrado y descifrado del payload y del token se comprobaron en memoria con
una clave aleatoria de prueba. El descifrado rechazó equipo, miembro y
propósito incorrectos. Esto confirma el contrato API y la criptografía local;
todavía no demuestra una escritura/lectura persistida en Supabase de producción.

Kubios entrega JSON legible a través de TLS. La integración lo cifra antes de
guardarlo en la caché. `KUBIOS_ENCRYPTION_KEY_V1` es una clave AES nueva de 32
bytes guardada solo en el servidor; es distinta de las claves heredadas del
dashboard y del secreto usado para invocar el cron.

## Rama integrada: verificaciones locales

Sobre la base de producción con K49/K50/K51/K52 integradas se observó:

| Comprobación | Resultado |
|---|---|
| `npm run check` | Tipos servidor/app, lint y capas correctos; 241 pruebas Vitest en 33 archivos |
| `npm run test:kubios` | 291 pruebas Node, 0 fallos, 0 omitidas |
| Runner PostgreSQL aislado K47/K49 | 161/161 comprobaciones |
| Playwright personal con APIs interceptadas | 8/8 escenarios |
| `npm run build` | Compilación de producción correcta, incluidas rutas personales y cron |

El build emitió avisos preexistentes sobre `themeColor` en metadata y un log
de contadores vacíos de Overview; no hubo errores de compilación ni supresión
de errores de tipos. La compilación se realizó sin credenciales de producción
en el worktree. No acredita el funcionamiento remoto del cron o de las RPC.

La revisión detectó un consumidor colectivo antiguo en Estudio. K52 retiró
sus consultas Kubios, selector de otros usuarios, HRV ficticio y conclusiones
HRV sin medidas. El estudio colectivo ofrece un enlace a la vista personal
solo cuando hay mediciones propias. Cinco pruebas adicionales verifican su
renderizado y las restricciones del consumidor; el build final incluye K52.

La configuración heredada de ESLint todavía excluye `src/app/study/**` y
`StudyCharts.tsx`; esas dos piezas se comprobaron mediante tipos, build y
pruebas focales, no por lint efectivo. Se quitaron las exclusiones de las
rutas Kubios, su página personal y `HRVCharts.tsx` para validar esas piezas.

Tras la revisión independiente se amplió el runner PostgreSQL: ahora aplica
los SQL reales T025/T053 de la release sobre fixtures de users y seis tablas
de salud antes de la migración Kubios. Conserva las 147 comprobaciones y añade
14 de compatibilidad: permisos de tabla y columna, ACL de PUBLIC, secuencias,
políticas, RLS y preservación de filas ficticias. El resultado fue 161/161, con
el contenedor aislado eliminado. Esto cubre los SQL de privacidad reales sobre
datos sintéticos, sin reproducir PostgREST, GoTrue o sesiones remotas.

También se corrigió el resumen al filtrar fechas: total y última medición
proceden del rango seleccionado; con un rango vacío no se reutiliza la última
medida global. Dos escenarios de navegador nuevos fallaron con el código
anterior y pasaron con el cambio. Los clientes Supabase del cron y del CLI
ahora rechazan HTTP remoto, credenciales embebidas y claves públicas antes de
crear un cliente o hacer red; HTTP se permite únicamente en hosts locales.

Fuera del alcance de Kubios, Estudio conserva los fallbacks sintéticos de
diabetes (`generateSample*`) y algunos valores predeterminados de sus gráficos.
Ante datos ausentes o una respuesta fallida pueden aparentar datos reales.
Se propone retirarlos o separar explícitamente un modo de demostración en una
tarea posterior. Esta integración no utiliza esos fallbacks para Kubios.

## Alcance de sincronización y acceso personal

El plan autorizado pide descargar los usuarios enlazados o dentro del grupo
Kubios. Por eso el sincronizador recorre los miembros del equipo autorizado,
incluidos quienes aún no tengan una cuenta vinculada del dashboard, y conserva
sus snapshots cifrados en el esquema privado. La pasada real de validación
se limitó a la cuenta indicada por el humano; eso no constituye una limitación
adicional del alcance del cron diseñado.

Este alcance de recogida es distinto del acceso web: ninguna ruta ofrece un
listado colectivo. La cookie verificada identifica un UserID entero; solo su
vínculo administrativo permite resolver el snapshot propio. El rol admin no
amplía ese acceso. Una prueba del adaptador HTTP ejecuta dos cookies de sesión
en paralelo con resultados cifrados distintos y comprueba la separación y la
denegación antes de cualquier RPC tras revocar una sesión. Sus dependencias
de autenticación/PostgREST están simuladas; no sustituye la prueba remota con
dos cuentas después de publicar.

## Vínculo de la cuenta con datos

La consulta dirigida al nombre de usuario exacto indicado por el humano no
encontró una cuenta equivalente en `public.users.Username`. Se solicitó
confirmar el usuario del dashboard que debe recibir el vínculo. No se creó
una cuenta, no se asignó un miembro por aproximación y no se leyó el listado
de datos clínicos para inferir su identidad.

## Ampliación autorizada: cuenta confirmada y caché real

Después de la fase inicial de solo lectura, el humano identificó la cuenta
exacta y autorizó su renombrado y vínculo. La base remota tenía un mecanismo
de propiedad posterior a T009: alias privados, protección de identidad y
guardas de versión/propietario en cinco tablas de salud. La función T009 no
se utilizó para forzar ese esquema. Los intentos que detectaron diferencias
en el esquema se revirtieron explícitamente y se verificó su reversión.

La operación puntual se probó en PostgreSQL aislado con esas guardas e índice,
se guardó una copia cifrada recuperable y se obtuvo aprobación específica
para las excepciones temporales. La transacción confirmada conservó el ID,
contraseña, UUID, rol y consentimiento, los valores/versiones/identificadores
de los registros de salud y las identidades del índice. Solo actualizó las
etiquetas de nombre del mismo propietario; todas las guardas quedaron activas.
Se verificaron también los registros anteriores mediante sus campos completos
salvo el nombre, sin publicar contenido clínico.

En esa transacción se aplicó el esquema Kubios privado. Después se asignó el
vínculo explícito mediante el CLI y se cargó únicamente el miembro autorizado:
login 302, resultados 200, dos mediciones. Token y snapshot se cifraron antes
de persistir; la lectura de la RPC se descifró en memoria y coincidió con el
payload original. El lector personal de servidor respondió `ready`, con dos
mediciones; una identidad distinta sin vínculo no recibió datos. Se liberó
el lease con un código de pasada manual parcial, sin marcar sincronizado el
equipo completo.

Una consulta posterior confirmó activas las cinco guardas de salud y la guarda
de identidad. El proyecto no dispone de
`supabase_migrations.schema_migrations`: el esquema aplicado se comprobó por
catálogo y permisos; no se debe interpretar la ausencia de historial como
autorización para volver a ejecutar las migraciones históricas.

Límites: para esa comprobación del lector se inyectó la dependencia de sesión;
no se probó un inicio de sesión real ni el dashboard desplegado. La clave AES
privada debe conservarse estable para poder leer el snapshot ya guardado. No
se hizo push ni despliegue, no se instaló ni activó el job automático y no se
consultaron resultados del resto de miembros.

## Límites de esta evidencia

La validación real no mide la cuota del proveedor ni demuestra el acceso a
resultados de todos los miembros. Un error de un miembro conserva su snapshot
previo y degrada el estado de sincronización; no autoriza publicar datos ajenos.
La aceptación final exige las pruebas de la rama integrada y la revisión humana
de sus tarjetas. La configuración de variables y la activación de producción
se documentan por separado.
