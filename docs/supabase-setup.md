# Supabase setup

Guía de prerrequisitos y pendientes para preparar Supabase. **No implica que migraciones, RLS, vinculación de Auth o cambios remotos estén aplicados.** El estado y la evidencia por tarea se mantienen en `docs/registro-tareas.md`.

## Estado de integración

- Estado actual: `dev` `fcb2bda`; **código local validado / Supabase remoto pendiente**.
- Checks del root: `npm run check` 177 tests/27 archivos, lint de `src`+tests 0 errores/0 warnings, TypeScript server+app 0, build PASS, audit producción 0. Build final `ktSETdnx6ZkFPtJqM5Gf9`.
- Launcher portable desde el root real: calendario 1/1 PASS + 12 browser PASS (2 backend real + 10 frontend mock), 0 fallos/skips; incluye resize 667x375→667x667, filtros clear, idioma/persistencia/storage bloqueado. T-066 cerrado.
- SQL local: T-054 65/65, 0 fail/warn/skip en PostgreSQL 16.15 con auth SQL + M1-M5; M5 `2d67b0d`. No aplicado en remoto.
- Visual: 20 PASS, 2 skips estructurales, 12 pixel PASS y 6 REVIEW de contenido esperado; sin CSS defectuoso ni claim de equivalencia pixel global.
- Config Vercel `82970b0` integrada como `9dbde4d` (T-062 PASS); guía: `docs/despliegue.md`.
- Entrega local: `codex/release/0.2.0`, que prepara el integrador tras el commit documental. Sin SQL remoto, Auth provisioning ni deploy real.

## Prerrequisitos conocidos

- `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` del proyecto.
- Una clave privada real, preferiblemente en `SUPABASE_SERVICE_ROLE_KEY`: JWT `service_role` o `sb_secret_` opaco válido, aceptados por el código actual. Una clave `anon` no habilita OpenAPI ni operaciones privilegiadas.
- PostgREST debe consultarse con `Accept-Profile: public` explícito. El perfil por defecto `api` puede devolver 404.
- Tablas físicas observadas: `users`, `insulindata`, `fooddata`, `exercisedata`, `periodrecords`, `mooddata` y `polar_data`. No usar alias con guion bajo sin verificarlos.
- `users.PasswordHash` se observó con prefijo bcrypt y longitud 60. De 21 usuarios, 17 usan bcrypt con coste 10 y 4 tienen un formato desconocido; esos 4 deben fallar cerrado. No se copiaron hashes ni credenciales.
- Cinco identidades de Supabase Auth no tienen `app_metadata.role` ni `app_user_id`. El acceso por email requiere una vinculación administrada explícita entre Auth y el usuario de aplicación; no se inventan identidades ni se infiere el vínculo.
- El username literal `all` sigue siendo un usuario normal. Solo el `null` interno de rol privilegiado representa alcance global; ningún string, incluido `all`, debe omitir el filtro. El IDOR se cerró en `3b2a675` y el helper se alineó en `1f8bf95`.
- La clave publishable permitió leer `PasswordHash` vía REST. Es un riesgo que deben bloquear RLS y grants; no se debe exponer el hash.
- Tipos, nulabilidad, defaults, PK/FK, unique, índices y RLS remotos no están verificados. Los fixtures SQL locales sí prueban RLS y roles reales en PostgreSQL local; eso no demuestra el estado remoto.

## Pendientes

1. **Migraciones remotas:** aplicar auth SQL + M1-M5 en staging con backup previo, archivo por archivo. No aplicadas en remoto.
2. **Vinculación Auth:** asignar `app_metadata.role` y `app_user_id` a las 5 identidades sin metadatos, con vínculo administrado explícito.
3. **RLS y grants remotos:** impedir lectura de `PasswordHash` y datos de salud con la publishable; verificar políticas por rol/tabla.
4. **Service role remota:** validar una clave privada `service_role` o `sb_secret_`; el runtime debe preferirla y no caer en `anon`.
5. **M4/M5 e ingestores:** las 6 tablas de salud y `users` quedan privadas para anon/authenticated/PUBLIC; los clientes legacy necesitan identidad/política dedicada, nunca service key en cliente.
6. **Datos sintéticos:** usar fixtures y datos de prueba; nunca PII ni datos de producción.
7. **Borrado:** un usuario con registros de salud asociados debe devolver 409 sin borrar datos ni identidad de Auth.
8. **Entrega:** preparar `codex/release/0.2.0` tras el commit documental del integrador; no publicar main/push/deploy sin ejecutar el flujo de release.

## Checklist operativo pendiente

No hay aplicación automática. Este checklist describe el orden operativo; no autoriza por sí mismo cambios remotos.

- [ ] **SQL remoto:** aplicar auth SQL + M1-M5 en staging, con backup y preflight abortivo. No aplicado.
- [ ] **Auth remoto:** vincular explícitamente las 5 identidades con `app_metadata.role`/`app_user_id`; no inferir nombres.
- [ ] **Hashes:** los 4 no-bcrypt fallan cerrado; reset manual autorizado, sin adivinar algoritmo.
- [ ] **RLS/grants:** verificar en remoto que publishable no lee `PasswordHash` ni datos de salud.
- [ ] **M4/M5:** confirmar privatización de 6 tablas de salud y `users`; ingestores legacy con identidad/política dedicada, nunca service key en cliente.
- [ ] **Entorno remoto:** configurar `SUPABASE_URL`, publishable y service role válida; `AUTH_SESSION_SECRET` estable; cifrado actual/anterior.
- [ ] **Vercel:** importar repo, Node 24.x, `npm ci`, `npm run check && npm run build`, `.next`; Preview separado de Production.
- [ ] **Entrega:** preparar `codex/release/0.2.0` tras el commit documental; no main/push/deploy automático.
- [ ] **Rollback:** el rollback de Vercel no revierte SQL ni reabre anon; no borrar tablas automáticamente.

## Niveles de evidencia

No mezclar estos niveles al reportar resultados:

- **SQL local:** PostgreSQL 16.15/Docker o PGlite; valida migraciones y transacciones, no RLS ni despliegue remoto.
- **HTTP stand-in:** mocks Postman del wire de Supabase; valida contratos y flujos, no la base real.
- **UI con API mock:** Playwright contra el frontend con API simulada; valida presentación e interacción, no el backend.
- **Supabase real readonly:** inspección mínima de metadatos/lectura; no escribe, no aplica migraciones y no valida login completo.

## Verificación futura

Cuando se aplique el SQL final en staging y la validación remota lo autorice:

- revisar tablas, columnas, constraints, índices y políticas en staging;
- comprobar la vinculación Auth↔usuario con counts y huérfanos, sin PII;
- probar login email/username, expiración, logout y revocación;
- probar borrado con y sin registros;
- verificar que la publishable no puede leer `PasswordHash`;
- registrar la evidencia en `docs/registro-tareas.md`.

No aplicar migraciones en producción ni ejecutar writes remotos sin autorización expresa. No incluir hashes, PII ni valores de claves en logs o documentos. Ningún PASS local, mock o readonly se considera PASS de release.
