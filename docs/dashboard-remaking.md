# Dashboard Remaking: implementación y revisión

Entrega local del 3 de noviembre de 2026 en `codex/feature/dashboard-remaking`,
sobre `3575aac`. Se conserva el commit anterior de la release y el archivo
local `progress.txt`. No se ha hecho push ni desplegado esta entrega.

## Comportamiento

- `/login` acepta correo o nombre de participante, incluidas las credenciales
  legacy cuyo nombre tiene forma de correo. El servidor resuelve la identidad
  y el rol real; la UI no intenta otro método tras una denegación. Ambas
  credenciales usan la misma cookie HttpOnly.
- `/` es el inicio común por permisos. `/app-login` y `/app-dashboard`
  redirigen al login y al inicio comunes. `doctor` conserva lectura y no
  recibe operaciones administrativas de escritura.
- Health Data muestra directamente las categorías del usuario. La consulta
  global autorizada recorre las páginas de datos y de usuarios; los conteos,
  filtros y exportaciones usan el mismo conjunto. El autocompletado admite
  teclado, limpieza y ausencia de coincidencias.
- Todas las exportaciones de Health Data comparten 25 columnas. Conservan
  los dos tiempos de insulina, ceros, booleanos, acentos y registros
  colapsados. Excluyen claves y campos de cifrado. El texto que podría
  interpretarse como fórmula se exporta como texto.
- La tabla y las tarjetas móviles comparten búsqueda, total y página de
  usuarios. Tamaños 10/25/50, inicial 25; barra horizontal superior
  sincronizada cuando la tabla desborda.
- Selector de idioma en el layout, incluido el login; diccionario ES/EN,
  fechas según idioma, etiquetas sin posesivos y tarjetas sin métricas
  ficticias. HRV y Kubios comparten identidad y criterio de disponibilidad,
  incluidos resultados en caché desactualizados.

## Datos sintéticos autorizados

El usuario corrigió la cuenta original del plan: la actual es
`jiahao.yang@ulpgc.es`. Se comprobó una coincidencia única de usuario y una
identidad Auth con correo confirmado, sin un UUID contradictorio.

Lote `DR-20261103-v1`: ocho registros de ejercicio, ocho de comida y ocho de
insulina. El primer `apply` añadió 24; el segundo añadió cero. Se mantienen
el formato y cifrado existentes. Los identificadores reservados negativos
permiten reconocer el lote sin añadir columnas ni cambiar el esquema. Un
identificador ocupado o un registro modificado provoca una denegación de la
operación, nunca una sobrescritura.

Desde la raíz del repositorio:

```powershell
node scripts/seed-dashboard-dr.mjs plan
node scripts/seed-dashboard-dr.mjs verify
# Solo para retirar este lote validado; no borra otros registros:
node scripts/seed-dashboard-dr.mjs remove
```

El script carga la configuración privada local sin imprimirla. No se deben
copiar secretos a argumentos, tarjetas ni registros. `plan` y `verify` no
escriben en la base. Tras un resultado incierto, ejecutar primero `plan`
para reconciliar los identificadores antes de repetir una escritura.

La comprobación real de solo lectura se activa explícitamente:

```powershell
$env:DR_VERIFY_LIVE_SEED = '1'
npx vitest run tests/unit/dashboard-seed-live.test.ts
Remove-Item Env:DR_VERIFY_LIVE_SEED
```

Genera `test-results/dashboard-remaking/seed-health.csv` y `.json`, con solo
los registros sintéticos del lote. La prueba de representación de ese
readback usa una sesión de presentación simulada: no demuestra el login
real de la persona ni sustituye su revisión humana.

## Comprobaciones y límites

Las evidencias de cada ejecución se guardan localmente en
`C:/Users/Jia_admin/AppData/Local/Temp/codex-tanausu-dr/`.

| Comprobación | Evidencia |
|---|---|
| TypeScript de servidor y aplicación, lint, capas y Vitest | `npm run check`: 322 pasadas; dos live omitidas por defecto y ejecutadas aparte con éxito; `integration-check.log` |
| Build Next | `npm run build` final pasado; `build-final.log` |
| Regresión Kubios | 290 pruebas pasadas y una omitida que requiere entorno específico; `kubios-tests.log` |
| API real + dependencia HTTP simulada | Build compilado arrancado en 4631: 15 pruebas existentes y tres nuevas pasadas, 32 usuarios y 1.011 registros; `acceptance-final.log` |
| Colección Postman | 22 solicitudes y 48 aserciones, sin fallos sobre el build compilado; `acceptance-final.log` |
| Contratos UI con API simulada | Siete casos shell, siete de datos y siete HRV pasados; incluyen respuestas fuera de orden, caché stale y filtro fallido; `ui-contract-tests.log`, `data-fix-tests.log`, `hrv-browser-tests.log` |
| Navegador y servidor real con Supabase simulado | Seis casos de login, sesión, CRUD, categorías, CSV, idioma, paginación, scroll y presentación del lote; `browser-final.log` |
| Base real y lote | Dos pruebas opt-in pasadas: lote de 24 con CSV y lectura global de 646 registros de 11 usuarios, sin exponer valores de salud; `seed-applied.json`, `seed-repeated.json`, `live-data-counts.json` |

La simulación prueba el código del dashboard contra un sustituto de Supabase.
No acredita todas las políticas RLS del proveedor real, una autenticación
real como la cuenta confirmada ni el despliegue nuevo en Vercel. El contexto
reutilizable está en `postman/simulations/supabase-local.context.yaml`.

El CLI Postman instalado es 1.74.0 y no ofrece `postman status`; sí se han
ejecutado la simulación y la colección local. No se han instalado
dependencias nuevas para esta entrega.

## Revisión independiente

Se aplicó `agent-work-contract` con propiedad de archivos separada y agentes
OpenCode `opencode-go/deepseek-v4.1-flash#max`. Implementadores, validador y
revisor de seguridad trabajaron con contratos independientes. El coordinador
ejecutó las comprobaciones y serializó las publicaciones en Tanausú.

La revisión encontró y corrigió el selector duplicado, mensajes sin traducir,
respuestas antiguas que podían sobrescribir filtros, discrepancias de caché
HRV y atribución de métricas globales a un rango fallido. También se reforzaron
la confirmación del objetivo del seed, la conservación de texto hexadecimal
válido y `Cache-Control: private, no-store` para las respuestas privadas.

El recheck de seguridad cerró los hallazgos originales. Límites documentados:

- Auth/settings real devolvió `mailer_autoconfirm=false`; la confirmación de
  correo debe permanecer activa antes de DR29. El registro público del
  proveedor está habilitado; no se cambió esa política remota.
- El formato histórico de doble cifrado no tiene una marca explícita. La
  compatibilidad se conserva, incluidos textos hexadecimales válidos; un
  formato versionado sería una mejora posterior de integridad.
- La retirada selectiva se implementa con validación estricta. Si se elimina
  la identidad Auth confirmada, el script se detiene hasta reconciliarla.

Los informes completos y rechecks están en el directorio local de evidencia.
No constituyen aceptación humana ni una afirmación de seguridad absoluta.

## Estado de las tarjetas

| Tarjetas | Alcance implementado o condición pendiente |
|---|---|
| DR01–DR02 | Identidad, rol y sesión; revisión humana pendiente |
| DR03–DR05 | Login, inicio y navegación comunes; revisión humana pendiente |
| DR06–DR13 | Consulta, conteos, filtros, presentación y HRV; revisión humana pendiente |
| DR14–DR15 | Esquema y exportación CSV; revisión humana pendiente |
| DR16–DR19 | Tabla, API paginada, controles y scroll; revisión humana pendiente |
| DR20–DR23 | Inventario de traducciones, correcciones y selector compartido; revisión humana pendiente |
| DR24–DR26 | Lote real de 24 registros en la cuenta corregida, verificado; revisión humana pendiente |
| DR27 | Regresión ejecutada, revisión independiente realizada y hallazgos corregidos; aceptación humana pendiente |
| DR28 | Aceptación humana de las tarjetas nuevas y comprobación de las anteriores; pendiente |
| DR29 | Bloqueada hasta el cierre humano de todas las demás tarjetas de trabajo del tablero |

La implementación no permite considerar finalizadas las tarjetas sin la
aceptación humana acordada. Después de esa aceptación, DR29 deberá revisar
el diff y el contenido aprobado, publicar en la rama de despliegue existente,
verificar Vercel y registrar commit, URL, pruebas de humo y reversión.
