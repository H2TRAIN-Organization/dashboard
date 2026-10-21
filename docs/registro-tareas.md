# Registro de tareas

Registro retrospectivo y de seguimiento. Timestamps en ISO 8601 con offset de la zona IANA `Atlantic/Canary`, verificados con `zoneinfo` (no con la zona de Windows). El Timestamp corresponde al inicio de la tarea o sesión; los hitos de cierre se indican en Observaciones. Orquestador: Codex. Agentes: OpenCode con modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`, verificado en T-004. Roles paralelos obligatorios y Git Flow con merges `--no-ff` y PASS modular antes de release. Los frentes trabajan en worktrees aislados con archivos delimitados; el integrador es el único operador git. Los resultados distinguen SQL local, HTTP stand-in, UI con API mock y Supabase real readonly. No se declara terminada la implementación ni se afirman pruebas superadas ni release.

Rol: Implementador
Timestamp: 2026-10-21T12:10:15+01:00
Tarea ejecutada: Sesión planificadora de diagnóstico del dashboard (solo lectura).
Resultado: Identificó autenticación insegura: `AuthContext` fuerza el rol `admin` para toda sesión y `AppAuthContext` expone `PasswordHash` al navegador y acepta cualquier contraseña no vacía. Detectó `src/lib/supabase-admin.ts` vacío que rompe las rutas admin, CRUD de usuarios directo desde el navegador, endpoints sin autorización, contratos y nombres de tablas inconsistentes, y credenciales embebidas como fallback. Propuso backend integrado en Next.js con Clean Architecture/SOLID y contratos preliminares.
Observaciones: Sesión `ses_ea1d869c2ffenB0UXFMgR2ABi4`. Sin cambios en archivos. No se validaron esquema remoto, RLS, algoritmo/formato de hash ni cifrado; no se reproducen secretos. Excluidos `pi-mqtt-agent`, `kub-kubioscloud-demo` y la integración Kubios.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T12:10:13+01:00
Tarea ejecutada: Inspección independiente de autenticación, usuarios, contratos, configuración de build/lint/types y pruebas disponibles (solo lectura).
Resultado: Confirmó bloqueos: login admin con rol forzado, login por usuario sin verificación real, APIs sin sesión ni rol, administración de base de datos rota, contratos inconsistentes, build permisivo, secretos embebidos, navegación de la app incompatible y README con esquema no verificado. Veredicto: no apto para implementación hasta validar el esquema real y el formato de hash en staging.
Observaciones: Sesión `ses_ea1d8707dffeCvLhbvHQtFaniy`. No consultó producción ni reprodujo secretos. Sin cambios en archivos. Los criterios de aceptación propuestos incluyen build/tsc/lint, RBAC en servidor, dos accesos, pruebas de contratos y E2E.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T12:10:13+01:00
Tarea ejecutada: Propuesta de formato y flujo de registro documental (solo lectura).
Resultado: Propuso el archivo `docs/registro-tareas.md` con los campos Rol, Timestamp, Tarea ejecutada, Resultado y Observaciones; timestamps ISO 8601 Atlantic/Canary; estados `pendiente`, `en curso` y `pendiente de validación`; Git Flow con `dev`/`main`, ramas `codex/feature/*` y `codex/release/*`; Conventional Commits; cierre exclusivo por el validador.
Observaciones: Sesión `ses_ea1d870adffe6thvara2J7YKIy`. No creó ni modificó archivos. Esta propuesta se materializa en T-003.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T12:14:54+01:00
Tarea ejecutada: T-001 — Base arquitectónica, contratos OpenAPI y herramientas del backend integrado (alcance foundation).
Resultado: COMPLETADO el alcance foundation, commit `bd1c138`. `npm run check` PASS: typecheck backend, lint, capas y 29 tests en 6 archivos. OpenAPI válido con 1 warning de licencia. `npm audit --omit=dev`: 0 vulnerabilidades de producción. `npm run test:e2e`: 2 tests skipped, NO PASS. `npm run build` falla por `src/lib/supabase-admin.ts` vacío legacy. `npm run typecheck:app`: 187 errores legacy. Este estado es anterior a la integración T-012 y no es el estado final.
Observaciones: Sesión `ses_ea1d42508ffegXWLdO346a5i0e`; inicio 12:14:54, cierre 12:30:24. Sin merge, push ni despliegue. El contrato foundation con Bearer es transitorio y una DESVIACIÓN; T-012 debe corregirlo a cookie HttpOnly sin token JSON. No se documenta Bearer como objetivo ni implementado.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T12:14:54+01:00
Tarea ejecutada: T-002 — Revisión estática de la base, autenticación, contratos y criterios de regresión (solo lectura; sin pruebas).
Resultado: Terminada sin PASS. Base `dev` @ `8ed4a3d`: Next 15.4.6, React 19.1.0, Node 24.16.0, sin runner; `next.config.ts` ignora TypeScript/ESLint. Confirmó auth insegura (rol admin forzado, login por usuario que acepta cualquier contraseña, `PasswordHash` expuesto, identidad en `localStorage`, logout híbrido, guards y navegación inconsistentes), APIs sin sesión/rol e IDOR, CRUD directo desde navegador, `supabase-admin.ts` vacío, borrado sin 409, contratos que mezclan `insulin_data`/`insulindata`, `food_data`/`fooddata`, etc., `dateFilter` ignorado y `timeRange` con fallback. `main` @ `3a7bcb9` difiere de `dev` en 59 archivos. Postman CLI 1.74.0: `--version`, `collection run -h` y `simulation -h` correctos; simulación >=1.70 soportada; solo se comprobó help/version, sin requests ni verificación de workspace/entitlements. Veredicto: no apto para release; faltan T-001 final, esquema/hash y entorno.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhQ`; inicio 12:14:54, informe final 12:17:35. No editó, instaló ni ejecutó pruebas. Decisión del orquestador: base `dev`; NO incorporar `main` ni endpoints heredados `fix-ids`/`sync-auth`.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T12:14:54+01:00
Tarea ejecutada: T-003 — Creación de `docs/registro-tareas.md`; actualización de `README.md` y `.env.example` con placeholders.
Resultado: Entregó el registro de sesiones y tareas, alcance y exclusiones, Git Flow, estado de implementación y guía de configuración/verificación. `README.md` sustituyó el esquema SQL no verificado por un procedimiento de inspección en Supabase. `.env.example` quedó con placeholders. No se modificó código, contratos ni configuración de la aplicación; solo `docs/`, `README.md` y `.env.example`.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio 12:14:54, entrega 12:18:38. `.env.example` quedó excluido por `.gitignore` (`.env*`); no se forzó staging ni se ejecutó `git add`, `commit`, `checkout`, `merge` o `push`. Sin pruebas ni validación real de Supabase. T-003 se corrige en T-005.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T12:19:26+01:00
Tarea ejecutada: T-004 — Inspección remota readonly de Supabase REST/OpenAPI y metadatos de sesiones OpenCode.
Resultado: Completada readonly. El perfil REST por defecto `api` devolvía 404; con `Accept-Profile: public` explícito respondió 206. Nombres físicos confirmados: `users`, `insulindata`, `fooddata`, `exercisedata`, `periodrecords`, `mooddata`, `polar_data`; `polar_data` sin filas. Muestra mínima de `PasswordHash`: 3 filas, 0 vacías, longitud 60, prefijo bcrypt; no se exportaron valores. Con la clave publishable se pudo leer `PasswordHash` (riesgo observado). No se obtuvieron tipos, nulabilidad, defaults, PK/FK/unique/índices ni RLS; OpenAPI no accesible con publishable. Sin writes, login ni pruebas.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhQ`; inicio 12:19:26, cierre 12:22:16. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`, verificado en 7/7 sesiones top-level. No se incorporó `main` ni `fix-ids`/`sync-auth`.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T12:19:25+01:00
Tarea ejecutada: T-005 — Actualización documental: T-002 estática, T-004 en curso, corrección de timestamps, README y `.env.example`.
Resultado: Registro actualizado con T-002 terminado sin pruebas ni PASS, T-004 en curso y decisión de base `dev`. README corregido: la excepción `!.env.example` es trabajo autorizado del implementador y no requiere nueva aprobación; variables ajustadas a `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, cifrado y sesión; sin duplicar la URL pública de cliente si todo pasa por servidor; sin endpoints heredados. Timestamps corregidos con la zona IANA `Atlantic/Canary` a partir de las sesiones reales.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio de T-005 12:19:25. Solo se editaron `docs/`, `README.md` y `.env.example`; sin git mutante, instalaciones, pruebas ni Supabase real. En la comprobación de T-005, `.env.local` ya declaraba además los nombres `SUPABASE_SECRET_KEY`, `ENCRYPTION_SECRET_KEY` y `ENCRYPTION_SECRET_KEY0`; no se copiaron valores ni se verificó su validez. `.env.example` sigue ignorado; no se forzó staging. T-001 sigue en curso y no se declara Next 16 implementado.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T12:23:19+01:00
Tarea ejecutada: T-006 — Inspección readonly de esquema con clave privada para desbloquear tipos y constraints.
Resultado: Completada readonly sin desbloquear el esquema. La clave entonces etiquetada `SUPABASE_SECRET_KEY` era un JWT con `role=anon`, no una clave service_role: `GET /rest/v1/` con esa clave devolvió 401 Invalid API key; con publishable + Bearer devolvió 401 Secret API key required. Se mantuvo la evidencia de T-004 (perfil `public`, tablas confirmadas, bcrypt longitud 60 en 3 filas). Claves de cifrado presentes, 64 caracteres hexadecimales; no se verificó algoritmo, IV ni equivalencia. El usuario corrigió la clave posteriormente; auth y persistencia la están inspeccionando. No se repite la clave inválida como estado actual sin nueva verificación.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhQ`; inicio 12:23:19, cierre 12:24:54. Sin writes, RPC, migraciones, login, PII ni hashes exportados. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T12:28:22+01:00
Tarea ejecutada: T-007 — Integración frontend y vista Usuarios en frente paralelo.
Resultado: COMPLETADO e integrado en `d089239`; 24 archivos. Integra sesión única, contexts, cliente API/DTO, guards/navegación y páginas del dashboard sin Bearer ni tokens accesibles por JS. T-022 validó la UI con API mock; E2E contra backend real sigue pendiente.
Observaciones: Sesión `ses_ea1c7d491ffejGuGuK6uXgYiqK`; cierre 12:46:21. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`. Sin cambios Kubios salvo los 8 tipos aprobados en `5c620e7`.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T12:28:21+01:00
Tarea ejecutada: T-008 — Autenticación y sesiones en frente paralelo.
Resultado: COMPLETADO e integrado en `e52435c`. 53 tests en 8 archivos PASS; typecheck y lint PASS en scratch. Implementa gateway email/username, token AES-256-GCM, cookie HttpOnly `dashboard_session`, bcrypt, adaptador Supabase/PostgREST, rate limit persistente, SQL y runtime. `SUPABASE_SERVICE_ROLE_KEY` válida; `SUPABASE_SECRET_KEY` aún con rol `anon` y el runtime debe preferir la clave validada. 21 usuarios: 17 bcrypt coste 10 y 4 con formato desconocido que deben fallar cerrado. 5 identidades Auth sin `app_metadata.role` ni `app_user_id`; email exige vinculación administrada explícita. Cambios remotos NO aplicados.
Observaciones: Sesión `ses_ea1c7d4c0ffevJO7CsB3fpaw3z`; cierre 12:43:36. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`. No toca root configs/package, docs, tests ajenos ni otros worktrees.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T12:28:21+01:00
Tarea ejecutada: T-009 — Persistencia Supabase, descifrado y SQL transaccional en frente paralelo.
Resultado: COMPLETADO e integrado en `180fab1`. 60 tests PASS; el defecto SQL detectado por T014 fue corregido y validado después: T028 59/59 PASS en PostgreSQL local y T032 65 tests PASS contra el root exacto `c524109`, sin puertos de escritura de email y con CRUD `{user}`. Nada aplicado en DB remota.
Observaciones: Sesión `ses_ea1c7d4c1ffepS3clkmphmVoOR`. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`. No toca root configs/package, docs, tests ajenos ni otros worktrees. Sin cambios remotos.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T12:29:41+01:00
Tarea ejecutada: T-010 — Pruebas de aceptación y Postman en frente paralelo.
Resultado: Artefactos preparados, sin PASS. Worktree `dashboard-worktrees/validation`; rama `codex/feature/acceptance-tests`; propiedad `postman/**` y `tests/acceptance/**`. 14 tests Node, 22 requests Postman V3, collection lint 22 sin errores, environment lint 0, `node --check` OK. Mock smoke HTTP 206/200 solo contra el stand-in; dashboard no ejecutado y suite sin URL quedó skipped (0 pass/0 fail). Los tests apuntan al contrato final con cookie HttpOnly.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhQ` (misma que T-002/T-004/T-006); inicio 12:29:41, cierre 12:37:54. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`. Sin commits, app ni DB real.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T12:30:07+01:00
Tarea ejecutada: T-011 — Documentación paralela de T-004/T-006 completados y frentes T-007 a T-010.
Resultado: Registro actualizado con T-004 y T-006 completados readonly, T-007 a T-010 en curso y T-001 aún en curso. README reorganizado a alcance, setup y convenciones, sin cronología de estados efímeros; la evidencia queda en este registro. `.env.example` mantiene placeholders y nombres reales, con advertencia de service_role. Se registró el Bearer de foundation como desviación transitoria pendiente de corregir a cookie HttpOnly. No se modificó código, configuración, contratos ni otros worktrees. Sin pruebas ni PASS.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio de T-011 12:30:07. `.env.example` sigue ignorado por `.env*`; no se forzó staging. Sin git mutante ni instalaciones. T-001 sigue en curso.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T12:32:06+01:00
Tarea ejecutada: T-012 — Integración foundation: cookie HttpOnly, contratos/body DTO y `dateFilter` de día completo.
Resultado: COMPLETADO e integrado en `a70741d`. Commits `0c8b592`, `2ab2aff`, `5c620e7`, `c367d7e`. `npm run check`: 42 tests en 8 archivos PASS; OpenAPI válido con 1 warning de licencia; audit de producción 0. El commit `5c620e7` contiene solo las 8 correcciones de tipos Kubios/StudyCharts autorizadas; no hay otro cambio de Kubios y el resto de esa integración sigue excluido.
Observaciones: Sesión `ses_ea1d42508ffegXWLdO346a5i0e` (misma que T-001); inicio 12:32:06, cierre 12:53:11. Sin push. La documentación mantiene cookie HttpOnly; Bearer no se documenta como contrato.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T12:35:25+01:00
Tarea ejecutada: T-013 — Validación visual en frente paralelo.
Resultado: Baseline corregida con dependencias originales: 20 PASS, 2 skips estructurales y 18 capturas. El bloqueo anterior era mezcla de dependencias en el harness, no un bug de producto. Sin equivalencia pixel todavía; candidato T038 pendiente.
Observaciones: Sesión `ses_ea1c15c98ffemmqGcQbo2TgdPX`. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`. Worktree validation, `tests/visual/**`; baseline detached en `baseline-ui` con datos sintéticos. No toca postman, tests/acceptance, tests/sql, fuentes frontend ni configs root.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T12:37:58+01:00
Tarea ejecutada: T-014 — Validación SQL en frente paralelo.
Resultado: Rerun original con 38/45; detectó el defecto del SQL real. Ese defecto fue corregido y validado después por T028 con 59/59 PASS en PostgreSQL local. T014 no emite PASS por sí mismo y no se aplicó nada en DB remota.
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`. No toca postman, tests/acceptance, tests/visual, fuentes ni configs root.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T12:39:52+01:00
Tarea ejecutada: T-015 — Alineación de mocks con auth/persistencia y revisión de seguridad.
Resultado: COMPLETADO el alcance de artefactos, sin PASS final. 22 requests Postman con lint 0 y 15 tests Node preparados; mocks amplios con registry, rate limit y RPC (`auth_sessions`, `auth_login_consume`/`auth_login_reset` y endpoints Auth). No se ejecutó contra backend real; no hay PASS.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhQ` (misma que T-002/T-004/T-006/T-010); cierre 12:47:16. Modelo exacto `opencode-go/deepseek-v4.1-flash` variante `max`. No toca tests/visual, tests/sql, fuentes ni configs root.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T12:41:24+01:00
Tarea ejecutada: T-016 — Documentación paralela: evidencia T-001, T-012/T-015, T-010, T-008 y frentes visual/SQL.
Resultado: Registro actualizado con T-001 completado en alcance foundation y su evidencia; T-012 integrador y T-015 en curso; T-010 con artefactos preparados sin PASS; T-008 con inspección de auth; T-013/T-014 en curso. README reducido a instrucciones de setup verificables, con cronología y límites en este registro. `.env.example` actualizado con `AUTH_SESSION_SECRET`, TTL y rate-limit reales del runtime auth, service_role preferida y sin claves generadas. Creado `docs/supabase-setup.md` con prerrequisitos y pendientes, sin afirmar migraciones o cambios remotos aplicados.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio de T-016 12:41:24. Solo se editaron `docs/`, `README.md` y `.env.example`; sin git mutante, instalaciones, pruebas, PASS ni otros worktrees. `.gitignore` ya incluye `!.env.example`; el archivo permanece sin staging ni commit. No se publicaron hashes, PII ni valores de claves.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T12:55:44+01:00
Tarea ejecutada: T-018 — Actualización documental y commit serial de solo docs/README/.env.example.
Resultado: Registro y setup actualizados con T-012 completado (commits `0c8b592`, `2ab2aff`, `5c620e7`, `c367d7e`; 42 tests/8 archivos PASS, OpenAPI válido con 1 warning, audit 0; runtime 503 y 16 errores TS frontend pendientes de T007), T008 completo (53 tests/8 archivos PASS, sin commit), T007 completo (24 archivos, sin commit ni E2E), T009 con 60 tests PASS pero SQL real defectuoso y T014 38/45 sin PASS, T015 con 22 requests lint 0 y 15 tests Node preparados sin backend real, y T013 con baseline en curso. Checklist operativo añadido a `docs/supabase-setup.md`: migraciones finales no aplicadas, vinculación explícita de 5 identidades Auth y 4 hashes no-bcrypt con fallo cerrado. `AUTH_SESSION_SECRET` de 32 bytes generado en archivo local ignorado; no se copió valor ni hash. Commit documental `docs(backend)` creado; SHA reportado en la entrega.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio de T-018 12:55:44. Se stagearon solo `README.md`, `.env.example` y `docs/**`; no se añadieron código, tests ni archivos ajenos. Sin merge, push, cambio de rama, instalaciones ni ejecución de pruebas. Revisión de secretos por patrones sin imprimir valores; `git diff --cached --check` y stat revisados. No hay aplicación automática ni nuevo flujo de aprobación.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T13:18:54+01:00
Tarea ejecutada: T-022 — Validación independiente del frontend en worktree.
Resultado: PASS de UI con API mock. Frontend `3806a3c` contra foundation `a70741d`: 7 tests Playwright de UI con API dashboard simulada, 42 tests unitarios, build y `tsc` PASS. Diseño, clases, rutas y gráficos preservados; llamada Kubios original del home preservada. Sin cambios Kubios salvo las 8 correcciones de tipos aprobadas en `5c620e7`. No valida backend real ni Supabase.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhQ`; inicio 13:18:54. Backend mockeado a propósito; la validación de servidor queda para HTTP stand-in y Supabase real readonly. Sin merge a `dev`.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T13:18:54+01:00
Tarea ejecutada: T-028 — Validación SQL real en PostgreSQL local.
Resultado: PASS SQL local. PostgreSQL 16.15: 59/59 PASS, 0 skip, con SQL original de auth y M1-M4, incluidas column privileges/policies sobre las 6 tablas de salud. No aplicado en DB remota. M4 privatiza esas 6 tablas y puede afectar a ingestores legacy con anon; necesitan identidad/política dedicada, no service key en clientes; esos clientes quedan fuera de alcance. T034 deja el runner portable activo.
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`; inicio 13:18:54. Sin writes remotos, PII ni claves. El SQL local no demuestra RLS ni despliegue remoto.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T13:20:47+01:00
Tarea ejecutada: T-029 — Runtime de producción lazy en el frente auth/runtime.
Resultado: Integrado en `77944c4`. Runtime de producción lazy con 6 tests y 105 scratch; sin fixture fallback, import de red ni SQL automático. Build/runtime posterior PASS; el backend real T-037 sigue en ejecución.
Observaciones: Sesión `ses_ea1c7d4c0ffevJO7CsB3fpaw3z`; inicio 13:20:47. Sin cambios remotos. No se declara PASS de backend real.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T13:26:07+01:00
Tarea ejecutada: T-030 — Diagnóstico `check-db` con clave privada.
Resultado: `check-db` valida clave privada, exige `--live` explícito, usa HEAD readonly y `process.loadEnvFile`; sin fallback a publishable, sin PII ni impresión de claves. Sin commit ni merge.
Observaciones: Sesión `ses_ea1c7d491ffejGuGuK6uXgYiqK`; inicio 13:26:07. No consultó Supabase real ni modificó otros archivos.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T13:26:08+01:00
Tarea ejecutada: T-032 — Compatibilidad de contratos de persistencia con el root `c524109`.
Resultado: Integrado en `180fab1`. 65 tests PASS contra el root exacto `c524109`, sin puertos de escritura de email y con CRUD `{user}`. Sin cambios remotos.
Observaciones: Sesión `ses_ea1c7d4c1ffepS3clkmphmVoOR`; inicio 13:26:08. El SQL M4 aprobado no se modifica.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T13:32:21+01:00
Tarea ejecutada: T-034 — Runner de fixtures SQL portable.
Resultado: Integrado. Runner portable con rutas canónicas, snapshot de metadatos sanitizado y overrides; el SQL de producto aprobado 59/59 se reejecutó en PostgreSQL local sin cambios remotos. Sin PII, claves ni rutas absolutas de usuario como requisito.
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`; inicio 13:32:21. El fixture sanitizado quedó versionado; no es evidencia de DB remota.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T13:36:07+01:00
Tarea ejecutada: T-038 — Candidato visual sobre frontend `3806a3c`.
Resultado: Captura completada: 20 PASS, 2 skips estructurales, 18 páginas desktop/mobile; 10 PASS pixel y 8 REVIEW. Dos regresiones reales (home con `+32px` por fallback “No disponible” y capitalización ES de “registros”) fueron corregidas por T-043 e integradas en `2bba6e0`; T-044 recheck corregido en maintenance queda pendiente. No hay claim de cero diferencias pixel.
Observaciones: Sesión `ses_ea1c15c98ffemmqGcQbo2TgdPX`; inicio 13:36:07. El resto de REVIEW son deltas de contenido admin/database/allowlist o Kubios excluido, no CSS. Sin commits de validación ni datos remotos.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T13:36:35+01:00
Tarea ejecutada: T-039 — Documentación de evidencia real, setup y niveles de verificación.
Resultado: Registro actualizado con foundation `a70741d`, auth `e52435c`, alignment `c524109` pendiente de review, frontend `3806a3c`/T022 PASS con API mock, baseline corregida y candidato T038 pendiente. T028 59/59 PASS SQL local; T032 65 PASS; T029 runtime listo sin merge; T030 check-db privado; T034 runner portable. Setup/README actualizados con checklist y distinción SQL local, HTTP stand-in, UI API mock y Supabase real readonly. Sin commit ni claims de release.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio 13:36:35. Solo `docs/` y `README.md`; sin git mutante, checkout, fuentes, claves, PII ni metadatos de host. Sin PASS global ni release.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T13:37:33+01:00
Tarea ejecutada: T-040 — Revisión modular independiente de persistence/maintenance y búsqueda de IDOR.
Resultado: Descubrió un IDOR real: un usuario con `username` literal `all` y rol `user` quedaba tratado como alcance global porque el repositorio interpretaba `all` como comodín. No se debe reservar el username; el contrato interno debe distinguir `null` (global privilegiado) de string literal (incluido `all`).
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`; inicio 13:37:33. Sin cambios de producto ni git. El defecto bloqueó temporalmente el merge de persistence hasta T-042.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T13:42:43+01:00
Tarea ejecutada: T-041 — Endurecimiento de diagnóstico maintenance.
Resultado: 7 tablas HEAD incluyendo `polar_data`; clave privada validada; URL estricta 7/7 (HTTPS `*.supabase.co` o HTTP loopback), fallo de una tabla sale 1; 14 HEAD sintéticos; sin fetch HTTP remoto ni fuga de secretos. P2 cerrados.
Observaciones: Sesión `ses_ea1c7d491ffejGuGuK6uXgYiqK`; inicio 13:42:43. Sin git mutante; integrado después en `7f2baa4`.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T13:45:31+01:00
Tarea ejecutada: T-042 — Revalidación del fix IDOR `all` en endpoints y repositorio.
Resultado: PASS. Ambos endpoints (`decrypted` y legacy `/api/data`) y el repositorio filtran por username literal, incluido `all`; solo `null` interno de rol privilegiado omite el filtro. Usuario normal no obtiene alcance global. T-045 confirmó el helper alineado.
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`; inicio 13:45:31. Sin cambios remotos. Se preserva compatibilidad HTTP con `selectedUser=all` normalizado solo para privilegiados.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T13:54:52+01:00
Tarea ejecutada: T-043 — Corrección de las dos regresiones visuales reales.
Resultado: Home usa fallback compacto `—` para porcentaje nulo, sin `+32px`; traducción ES de `dashboard.totalRecords` vuelve a “registros totales”. Sin rediseño ni cambios CSS. Integrado en `2bba6e0`.
Observaciones: Sesión `ses_ea1c7d491ffejGuGuK6uXgYiqK`; inicio 13:54:52. Solo 2 archivos; `tsc` full 0. Sin tocar Kubios.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T13:59:38+01:00
Tarea ejecutada: T-045 — Auditoría final readonly de seguridad, helper y lint full-src.
Resultado: Helper `null` vs `all` PASS. Checks del checkpoint: 177 unit tests/27 archivos, `tsc` app, lint backend, build `77944c4` y audit producción 0. Detectó que `npm run lint` omitía frontend: full `src` 51 errores/59 warnings (50 preexistentes +1 nuevo). Tras T-046/T-047/T-048, T-050/T-052 y la promoción `c9f6ef2`, el lint full `src`+tests quedó 0 errores/0 warnings; typecheck server+app 0 y build PASS.
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`; inicio 13:59:38. Asignados T-046/T-047/T-048 sin CSS ni supresiones. Sin claves, hashes, PII ni valores en la salida.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T14:02:58+01:00
Tarea ejecutada: T-046 — Corrección lint UI core.
Resultado: COMPLETADO y PASS T-056. 4 archivos (`home`, `app-dashboard`, `users`, `SessionContext`) con lint 0, tsc 0, 177 tests y sin cambios visuales/supresiones. Integrado en `2a2692b`.
Observaciones: Sesión `ses_ea1c7d4c0ffevJO7CsB3fpaw3z`; inicio 14:02:58. Observación P2 de carrera concurrente login/logout fuera del path normal, sin blocker. Sin cambios de producto fuera de su ownership.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T14:02:58+01:00
Tarea ejecutada: T-047 — Corrección lint UI data.
Resultado: COMPLETADO y PASS T-055. 3 archivos (`data`, `analytics`, `overview`) con lint 0, tsc 0, 177 tests y sin cambios de CSS/rutas/gráficos/filtros/HTTP. Integrado en `394cd73`.
Observaciones: Sesión `ses_ea1c7d4c1ffepS3clkmphmVoOR`; inicio 14:02:58. Sin cambios de producto fuera de su ownership.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T14:05:24+01:00
Tarea ejecutada: T-048 — Corrección lint shared.
Resultado: Integrado en `d7a1337`; 3 archivos: `decryption.ts`, `LanguageContext.tsx` y `useHydration.ts`. Sustituye `any` por tipos seguros y corrige hooks/init sin cambiar API legacy ni suprimir reglas. Después se añadió el scope full-src en `c819139`/`683899b`.
Observaciones: Sesión `ses_ea1c7d491ffejGuGuK6uXgYiqK`; inicio 14:05:24. Sin tocar Kubios ni configs; no hay PASS global de lint.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T13:58:35+01:00
Tarea ejecutada: T-037 — Pruebas backend real con Next dev y Supabase stand-in.
Resultado: PASS final. Next dev 4630 y Postman Supabase stand-in 4900 con entornos sintéticos: 15 Node con 0 skip, 22 requests Postman, 48 assertions y 2 pruebas browser. El API server fue byte-idéntico al checkpoint `c819`. El fallo inicial en cascada era cookie jar del runner; `settings.disableCookies:true` lo corrigió, no el producto. Node/Postman no se repitieron.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhQ`; inicio 13:58:35. Sin Supabase real ni SQL remoto. PASS de API/backend real contra stand-in, no de DB remota.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:02:17+01:00
Tarea ejecutada: T-044 — Recheck visual del candidato corregido.
Resultado: No se ejecutó el candidato intermedio: T-046/T-047/T-048 cambiaron componentes/hooks y se decidió una única captura final T-058. La evidencia T-038 se conserva como baseline/candidato inicial.
Observaciones: Sesión `ses_ea1c15c98ffemmqGcQbo2TgdPX`; inicio 14:02:17. Solo `tests/visual/**` y artefactos temporales; sin commits ni datos remotos. T-058 es el reporte final.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T14:06:33+01:00
Tarea ejecutada: T-049 — Documentación de merges reales, evidencia actual y límites de release.
Resultado: Registro/setup/README actualizados con checkpoint `dev` `2bba6e0` y estado actual `dev` `683899b` al cierre: `c524109` + merge `944ce3e` (contract), `d089239` (frontend), `3085056` (email types), `3b2a675` (IDOR), `1f8bf95` (helper), `180fab1` (persistence), `7f2baa4` (maintenance), `77944c4` (runtime) y `2bba6e0` (visual); después `d7a1337`/`c819139`/`683899b` añaden lint shared y scope full-src. Documentados IDOR `all` y su cierre, maintenance 7 HEAD/strict URL, T-034 fixture portable 59/59 local, 177 unit/27 archivos + tsc app + backend lint + build + audit 0. Registrado que la auditoría full-src en el checkpoint tenía 51 errores/59 warnings (50 preexistentes +1 nuevo), con T-046/T-047 core/data aún pendientes: NO hay ESLint dashboard PASS ni 177 final release hasta T-050. Visual: 20 PASS/2 skip/18 páginas, 10 pixel PASS/8 REVIEW, 2 regresiones corregidas e integradas; T-044 pendiente. Backend real T-037 en ejecución; primer fallo Postman en cascada/cookie jar, sin atribución al producto. Sin SQL remoto ni Auth provisioning aplicados. `AGENTS.md` es auto-generado por Next dev, no documentación del proyecto; debe quedar fuera del cierre y del commit documental.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio 14:06:33. Solo `docs/` y `README.md`; sin git mutante, checkout, fuentes, claves, hashes reales, PII ni rutas absolutas de host. `dev` avanzó de `2bba6e0` a `683899b` durante la documentación; los cambios posteriores no se revalidan aquí. No hay claim de release.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:08:55+01:00
Tarea ejecutada: T-050 — Revisión de warnings full-src y cierre de lint shared.
Resultado: T-048 shared PASS: 3 archivos, lint 0, tsc 0, 177 tests; SSR/storage fallback conservados. Revisión de 8 archivos con warnings fuera de core/data/shared (21 warnings: 17 unused + 4 no-img-element) y PASS para el fix del integrador sin CSS ni supresiones.
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`; inicio 14:08:55. Sin cambios de producto ni git. T-052 revisa los 8 archivos.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:12:59+01:00
Tarea ejecutada: T-051 — Prueba readonly de policies legacy en users.
Resultado: Descubrió un proof real: M3 habilita RLS en users pero una policy legacy PUBLIC/anon permitía leer UUID/GDPR a anon/authenticated. No era un riesgo hipotético. Recomendó una migración M5 que privatice users preservando service_role, sin tocar M1-M4.
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`; inicio 14:12:59. PostgreSQL local con fixtures sintéticos, nunca DB remota. Sin PII ni cambios de producto.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:13:52+01:00
Tarea ejecutada: T-052 — Revisión independiente de los 8 archivos con warnings.
Resultado: PASS. Cambios de imports/parámetros unused y Next/Image en logos conservan dimensiones, clases, `alt`, `src` y semántica visual. El diff de los 8 archivos queda apto para el integrador.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhO`; inicio 14:13:52. Sin cambios de runtime, fuentes ni git. No se repitieron Node/Postman.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T14:15:33+01:00
Tarea ejecutada: T-053 — Migración M5 de privacidad de users.
Resultado: M5 idempotente y transaccional: RLS en users, policies legacy PUBLIC/anon/authenticated eliminadas, privilegios de tabla/columna revocados, service_role conserva CRUD y secuencia, policies custom preservadas. Sin cambios de datos ni de M1-M4. Hash LF `d24f8c7098ffc2c1d1eea304f114b1609a9e39dda178b8d5c6eba0323b6c1b6b`.
Observaciones: Sesión `ses_ea1c7d491ffejGuGuK6uXgYiqK`; inicio 14:15:33. Integrada en `2d67b0d`. Sin claves crudas en documentos. No aplicada en remoto.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:15:33+01:00
Tarea ejecutada: T-054 — Validación M5 y regresiones SQL completas.
Resultado: PASS local: 65/65 checks, 0 fail/warn/skip en PostgreSQL 16.15, con auth SQL + M1-M5 y el hash LF exacto de M5. Cubre policies legacy, table/column ACL, RLS de users, integridad de datos, schema, policies custom, service_role CRUD/secuencia e idempotencia. M1-M4/auth permanecen intactos. No aplicado en DB remota.
Observaciones: Sesión `ses_ea1bf08e7ffe7iUGCRxlwGjO4o`; inicio 14:15:33. Runner portable y snapshot canónico. Sin PII ni claves.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:17:28+01:00
Tarea ejecutada: T-055 — Revisión independiente de lint data.
Resultado: PASS modular de T-047: 3 archivos (`data`, `analytics`, `overview`) con lint 0, tsc 0, 177 tests y sin cambios de CSS/rutas/gráficos/filtros/HTTP. Integrado en `394cd73`.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhO`; inicio 14:17:28. Sin escritura de producto ni git.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:18:49+01:00
Tarea ejecutada: T-056 — Revisión independiente de lint core.
Resultado: PASS modular de T-046: 4 archivos (`home`, `app-dashboard`, `users`, `SessionContext`) con lint 0, tsc 0, 177 tests y sin cambios visuales/supresiones. `SessionContext` usa store por provider y conserva login/logout/refresh; se deja observación P2 de carrera concurrente login/logout fuera del path normal, sin blocker.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhO`; inicio 14:18:49. Integrado en `2a2692b`. Sin cambios de producto ni git.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:25:43+01:00
Tarea ejecutada: T-057 — Suite browser FINAL: 2 backend real + 10 mock.
Resultado: Parcial PASS: 2 pruebas reales PASS (UseBuild production) y 9 mocks independientes PASS (7 UI previos + 2 language/storage). El target de calendario descubrió un bug preexistente de coordenadas `fixed` vs scroll offset; se envió a T-063 y queda pendiente. No se declara 10/10.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhO`; inicio 14:25:43; ejecución final 15:04:49. Sin producto, SQL ni git. No hay claim de release.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T14:27:46+01:00
Tarea ejecutada: T-058 — Captura visual FINAL.
Resultado: REPORT-FINAL: 20 PASS, 2 skips estructurales de viewport, 18 capturas, 12 pixel PASS y 6 REVIEW de contenido esperado (admin/DB, scope/Kubios, null stats). Home con height 0, Data “registros” lower PASS, charts con primitivas iguales y logos con geometría igual; solo optimización tiny sin defecto CSS real. Sin claim de equivalencia pixel global.
Observaciones: Sesión `ses_ea1c15c98ffemmqGcQbo2TgdPX`; inicio 14:27:46. Fuente `394cd73`, material UI root `c9f6ef2`; el fix final usa `—` para null, no fake 97. Sin datos remotos ni nuevas capturas.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T15:07:02+01:00
Tarea ejecutada: T-060 — Cierre documental y guía de despliegue Vercel.
Resultado: README/setup actualizados al estado real `dev` `c9f6ef2`: check 177/27, lint full src+tests 0/0, TS server+app 0, build PASS, audit 0; T-054 65/65 local; T-037 PASS 15 Node/22 Postman/48 assertions/2 browser; T-058 REPORT-FINAL; T-057 final pendiente. Creado `docs/despliegue.md` con verificación local (`npm ci`, `npm run check`, `npm run build`, `npm start`), import Vercel, Node 24.x, `npm ci` + `npm run check && npm run build`, env de servidor, SQL manual auth+M1-M5, provisioning Auth, Preview/GitFlow, rollback y pendientes. `.env.example` corregido con defaults válidos y service key JWT/`sb_secret_`, sin claves. Readiness `82970b0` pendiente de T-062/merge; no deploy ni SQL/Auth remoto.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio 15:07:02. Solo README, docs y `.env.example`; sin git mutante, checkout ni fuentes. Sin claves, hashes reales, PII, datos remotos ni metadatos de host. No se declara publicado ni release.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T15:08:02+01:00
Tarea ejecutada: T-061 — Configuración reproducible de Vercel.
Resultado: Commit `82970b0` desde `c9f6ef2`, sin upgrades de dependencias: `engines.node: 24.x` en package/lock, `vercel.json` con `npm ci`, `npm run check && npm run build`, framework Next.js y salida `.next`; `.vercelignore` excluye `.env*`, artefactos y directorios raíz no desplegables, conservando tests, migraciones y OpenAPI. `npm run check` 177/27, lint 0, tsc 0. T-062 revisa antes de merge.
Observaciones: Sesión `ses_ea1d42508ffegXWLdO346a5i0e`; inicio 15:08:02. Sin push, deploy, SQL remoto ni cambios de producto. La rama `codex/feature/vercel-readiness` no está mergeada.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T15:17:10+01:00
Tarea ejecutada: T-062 — Revisión externa de la configuración de despliegue.
Resultado: PASS. Revisó los 4 archivos de `82970b0`: Node 24.x, `npm ci`, build `npm run check && npm run build`, metadatos de lock sin upgrades, `.vercelignore` para env/artefactos/directorios excluidos y cookies de producción sin cambios. Integrado con `--no-ff` en `dev` `9dbde4d`.
Observaciones: Sesión `ses_ea1d42508ffegXWLdO346a5i0e`; inicio 15:17:10. Sin deploy, push, SQL remoto ni cambios de producto.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T15:19:11+01:00
Tarea ejecutada: T-063 — Fix de posición del calendario.
Resultado: Patch de 1 archivo (`src/app/data/page.tsx`, +53/-11, SHA `1012cdc…`): coordenadas `fixed` corregidas frente a scroll offset, altura/anchura medida del popup, padding de viewport, flip y clamp, overflow interno solo cuando hace falta. Lint 0 y TS app 0. Commit `5b0b8e3` en `codex/feature/calendar-position`; revisión estática, merge, build root y target calendario desktop/mobile/full 10 mock pendientes.
Observaciones: Sesión `ses_ea1c7d4c1ffepS3clkmphmVoOR`; inicio 15:19:11. Sin CSS/layout/API ni cambios fuera de ese archivo. No hay release.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T15:20:42+01:00
Tarea ejecutada: T-064 — Revisión factual de documentación y actualización de estado.
Resultado: Revisión factual/técnica PASS con estados stale corregidos: README/setup/guía reflejan `dev` `9dbde4d`, T-062 integrado, T-057 con 2 reales PASS + 7 UI + 2 language/storage PASS independientes, bug de calendario preexistente y T-063 pendiente. Guía de despliegue en 7 pasos, SQL/env/DAG/manual links PASS, sin otros defectos técnicos. No se declara 10/10, deploy ni release.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio 15:20:42. Solo README/docs/.env.example; sin git mutante, checkout ni fuentes. `progress.txt` de 0 bytes es desconocido y se preserva sin stage.

------------------------------------

Rol: Validador
Timestamp: 2026-10-21T15:34:52+01:00
Tarea ejecutada: T-065 — Portabilidad del harness de aceptación.
Resultado: PASS STATIC FREEZE. Eliminadas rutas absolutas de usuario de las fuentes de acceptance; imports normales desde `@playwright/test` y `@supabase/supabase-js`, `testDir` derivado de `import.meta.url`, raíz PowerShell desde `PSScriptRoot`. Suite de 10 casos incluye desktop/mobile/resize. 61 archivos portables integrados en `7fa1f21`/`fcb2bda`.
Observaciones: Sesión `ses_ea1d4251fffeujioV5kR8GtOhO`; inicio 15:34:52. Sin cambios de producto, Git, servidores ni SQL remoto.

------------------------------------

Rol: Implementador
Timestamp: 2026-10-21T15:36:08+01:00
Tarea ejecutada: T-066 — Corrección de altura del calendario al redimensionar.
Resultado: PASS STATIC. Corrige la medición recortada: aplica el ancho objetivo antes de medir, usa `scrollHeight` más bordes en vez de `rect.height` y resetea la posición al cerrar/seleccionar/clic fuera/toggle. Conserva coordenadas fixed, clamp/flip y filtros. Fuente SHA `1F30AA02F5B8A12C182A6765F701FDA7F466BACA51D16EC123E0B34273EECBB1`; 1 archivo, commit `0acc8f9`, merge `607d092`. El defecto quedó cerrado y validado después por T-067.
Observaciones: Sesión `ses_ea122dd7fffePuh3zz4frU324D`; inicio 15:36:08. Sin cambios de DOM/clases/CSS ni ampliación de scope.

------------------------------------

Rol: Documentador
Timestamp: 2026-10-21T15:43:48+01:00
Tarea ejecutada: T-067 — Cierre documental del resultado final.
Resultado: CIERRE LOCAL VALIDADO / SUPABASE REMOTO PENDIENTE. Root `dev` `fcb2bda3958906c879545fc82d47c3d16bb074d6`, BUILD_ID `ktSETdnx6ZkFPtJqM5Gf9`. Launcher portable desde la raíz real: calendario 1/1 PASS (6.4s) + 12 browser PASS (2/2 backend real en 10s + 10/10 frontend mock en 34.8s), 0 fallos/skips, con resize 667x375→667x667, filtros clear, idioma/persistencia/storage bloqueado. T-066 cerrado; sin bug ni gate de calendario. No se repitieron Node 15/Postman 22 (API server idéntico; evidencia previa 15 + 22/48). `npm run check` 177/27, lint 0/0, TS 0, build PASS; SQL local 65/65 y visual 20 PASS/2 skip/12 pixel PASS/6 REVIEW. User dev 3000 intacto; fixtures 4900/4630 parados. Sin SQL remoto, Auth provisioning ni deploy real. Entrega local para `codex/release/0.2.0`.
Observaciones: Sesión `ses_ea1d42504ffeiZdPGFHjocTx5O`; inicio 15:43:48. Solo README/docs/.env.example; sin git mutante, fuentes, tests ajenos ni claves/PII. `progress.txt` de 0 bytes se preserva sin stage. No se declara deploy, usuarios live ni release remoto.

------------------------------------
