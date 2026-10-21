# Supabase setup

Guía de prerrequisitos y pendientes para preparar Supabase. **No implica que migraciones, RLS, vinculación de Auth o cambios remotos estén aplicados.** El estado y la evidencia por tarea se mantienen en `docs/registro-tareas.md`.

## Prerrequisitos conocidos

- `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` del proyecto.
- Una clave privada real con rol `service_role`, preferiblemente en `SUPABASE_SERVICE_ROLE_KEY`. Una `SUPABASE_SECRET_KEY` solo es válida si su claim es `service_role`; una clave con rol `anon` no habilita OpenAPI ni operaciones privilegiadas.
- PostgREST debe consultarse con `Accept-Profile: public` explícito. El perfil por defecto `api` puede devolver 404.
- Tablas físicas observadas: `users`, `insulindata`, `fooddata`, `exercisedata`, `periodrecords`, `mooddata` y `polar_data`. No usar alias con guion bajo sin verificarlos.
- `users.PasswordHash` se observó con prefijo bcrypt y longitud 60. De 21 usuarios, 17 usan bcrypt con coste 10 y 4 tienen un formato desconocido; esos 4 deben fallar cerrado. No se copiaron hashes ni credenciales.
- Cinco identidades de Supabase Auth no tienen `app_metadata.role` ni `app_user_id`. El acceso por email requiere una vinculación administrada explícita entre Auth y el usuario de aplicación; no se inventan identidades ni se infiere el vínculo.
- La clave publishable permitió leer `PasswordHash` vía REST. Es un riesgo que deben bloquear RLS y grants; no se debe exponer el hash.
- Tipos, nulabilidad, defaults, PK/FK, unique, índices y RLS no están verificados. Requieren SQL read-only o una clave `service_role` real.

## Pendientes

1. **Migraciones:** esperar el SQL final de persistencia (`supabase/migrations/*.sql`). No hay migraciones aplicadas. Cuando exista la factory final, revisar el SQL y probarlo en staging antes de cualquier paso definitivo.
2. **Vinculación Auth:** definir e implementar la relación entre las identidades de Auth y `users`/`app_user_id` para los cinco casos sin metadatos. No asignar roles ni identidades por suposición.
3. **RLS y grants:** impedir lectura de `PasswordHash` y datos de salud con la publishable; verificar políticas por rol y tabla.
4. **Service role:** validar que la clave privada usada sea `service_role`; el runtime debe preferir la clave validada y no caer en una clave `anon`.
5. **Pruebas SQL:** T-014 prepara pruebas con PostgreSQL local en Docker o PGlite, no contra la DB real, para transacciones y SQL de autenticación. Sin resultados todavía.
6. **Datos sintéticos:** usar fixtures y datos de prueba; nunca PII ni datos de producción.
7. **Borrado:** un usuario con registros de salud asociados debe devolver 409 sin borrar datos ni identidad de Auth.

## Checklist operativo pendiente

No hay aplicación automática. Este checklist describe el orden operativo; no autoriza por sí mismo cambios remotos.

- [ ] **SQL final:** T-009 tiene 60 tests PASS, pero el SQL real conserva un defecto; T-014 reejecutó el original con 38/45. No cerrar ni declarar PASS de migración.
- [ ] **Migraciones:** aplicar el SQL final solo en staging. NO están aplicadas en remoto.
- [ ] **Vinculación Auth:** asignar explícitamente `app_metadata.role` y `app_user_id` a las 5 identidades Auth que carecen de ambos; no inferir ni inventar identidades.
- [ ] **Hashes no-bcrypt:** los 4 `PasswordHash` con formato desconocido deben fallar cerrado; no rehash automático ni reset.
- [ ] **RLS/grants:** impedir lectura de `PasswordHash` y datos de salud con la publishable.
- [ ] **Runtime:** el proyecto sigue parcial con 503 hasta el montaje real del composition root.
- [ ] **Frontend:** T-007 completó 24 archivos sin commit; 16 errores TS frontend siguen pendientes de integración y no hay E2E.
- [ ] **Auth:** T-008 completó 53 tests/8 archivos PASS en scratch, sin commit; falta integración real.
- [ ] **Aceptación:** T-010/T-015 tienen artefactos y mocks amplios (registry, rate, RPC), pero no backend real ni PASS.
- [ ] **Visual:** T-013 mantiene captura de baseline en curso; no hay equivalencia pixel.
- [ ] **Secreto de sesión:** `AUTH_SESSION_SECRET` de 32 bytes generado en archivo local ignorado; nunca copiar su valor ni hash a docs, logs o commits. La gestión de producción sigue pendiente.

## Verificación futura

Cuando exista la factory SQL final y la validación lo autorice:

- revisar tablas, columnas, constraints, índices y políticas en staging;
- comprobar la vinculación Auth↔usuario con counts y huérfanos, sin PII;
- probar login email/username, expiración, logout y revocación;
- probar borrado con y sin registros;
- verificar que la publishable no puede leer `PasswordHash`;
- registrar la evidencia en `docs/registro-tareas.md`.

No aplicar migraciones en producción ni ejecutar writes remotos sin autorización expresa. No incluir hashes, PII ni valores de claves en logs o documentos.
