# Despliegue en Vercel

Guía ejecutable para publicar el dashboard cuando las migraciones y la vinculación de Auth estén aplicadas. **No se ha desplegado nada**: el SQL/Auth remoto no está aplicado. El código local está validado en `dev` `fcb2bda` (BUILD_ID `ktSETdnx6ZkFPtJqM5Gf9`): launcher portable con calendario 1/1 + 12 browser PASS (2 backend real + 10 mock), 0 fallos/skips. La configuración `82970b0` está integrada como `9dbde4d`. La release está preparada: `codex/release/0.2.0`, HEAD `50f950e`, versión `0.2.0`; dev `96c25b6`. Solo queda la publicación remota y sus prerrequisitos.

## Prerrequisitos

- Node.js 24.x. Vercel documenta Node 24/22; este repo fija `engines.node: 24.x`:
  https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- Repositorio Git con el root del proyecto en `./`.
- Proyecto Supabase de staging con backup propio antes de migrar.
- Variables de entorno de Preview y Production separadas.

## Verificación local

Comandos efectivos del commit `82970b0`:

```bash
npm ci
npm run check
npm run build
npm start
```

`npm run check` incluye typecheck server+app, lint full `src`+tests, capas y 177 tests. `npm run build` genera `.next`.

## Vercel: web o CLI

1. Importar el repositorio Git en Vercel.
2. Root directory: `./`.
3. Framework: Next.js.
4. Node.js: 24.x.
5. Install Command: `npm ci`.
6. Build Command: `npm run check && npm run build`.
7. Output Directory: `.next`.

El `vercel.json` del commit `82970b0` (merge `9dbde4d`) ya declara `npm ci`, `npm run check && npm run build`, framework `nextjs`, salida `.next` y `.vercelignore` para `.env*`, artefactos y directorios excluidos. Mantener tests, SQL y OpenAPI en el repo: son necesarios para `npm run check`.

Git Flow: desplegar primero una rama `codex/release/*` como Preview. No publicar automáticamente a Production ni a `main`; la promoción a producción se hace cuando el usuario ejecute el flujo de release. Configurar la rama de producción más adelante, no en esta fase.

**Aviso de primer despliegue:** en un proyecto Vercel nuevo, el primer deploy se crea como Production aunque no se use `--prod`. Crear primero un proyecto Vercel de staging separado y cargar solo credenciales Supabase de staging, para que esa primera publicación nunca use datos ni credenciales de producción. No asumir que un primer `--target=preview` es inocuo en un proyecto nuevo.

CLI para proyecto ya inicializado (consultar la fuente oficial):

```bash
npx vercel link
npx vercel deploy --target=preview
```

La opción `--target` admite `preview`, `production` y `custom`:
https://vercel.com/docs/cli/deploy

Referencias:
- https://vercel.com/docs/projects/deploy-from-cli
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/git

## Producción

Solo después de validar staging:

1. Crear un proyecto Vercel de Production separado y configurar variables Production propias.
2. Aplicar en Supabase Production el mismo SQL auth + M1-M5 y el provisioning de Auth, con backup previo.
3. Promover la release a `main` mediante GitFlow.
4. Desplegar con la integración Git (push a `main`) o, desde `main`, con `npx vercel deploy --prod`.

`main` sigue siendo la rama de producción. El primer proyecto de Production debe estar etiquetado como tal y no reutilizar el proyecto de staging. Estos comandos son instrucciones futuras del usuario: **no se ejecutaron**.

## Variables de entorno

Solo servidor (nunca `NEXT_PUBLIC_` para secretos):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`: JWT `service_role` o `sb_secret_` opaco válido. El código actual acepta ambas clases y rechaza `anon`. Una clave privada nunca va al cliente.
- `ENCRYPTION_SECRET_KEY`: clave actual; no rotar por azar.
- `ENCRYPTION_SECRET_KEY0`: solo si se usa rotación y existe dato cifrado con la anterior.
- `AUTH_SESSION_SECRET`: 32 bytes aleatorios, estable entre instancias y despliegues del mismo entorno; debe ser distinto por entorno. No cambiar entre despliegues del mismo entorno.
- `AUTH_SESSION_TTL_SECONDS` (default 28800), `AUTH_LOGIN_WINDOW_SECONDS` (900), `AUTH_LOGIN_MAX_ATTEMPTS` (10), `AUTH_LOGIN_BLOCK_SECONDS` (900).

No existe `APP_ORIGIN`: el CSRF usa mismo origen. El login por email con SDK no requiere redirect OAuth para estos flujos. No usar `NEXT_PUBLIC_` para claves privadas.

## Supabase: migraciones manuales

Solo en staging, con backup propio y sin descargar PII:

1. Ejecutar en Supabase SQL Editor, archivo por archivo:
   - `src/server/infrastructure/auth/supabase-auth-schema.sql`
   - `supabase/migrations/20261021120000_t009_health_username_integrity.sql`
   - `supabase/migrations/20261021120100_t009_user_admin_rpcs.sql`
   - `supabase/migrations/20261021120200_t009_password_hash_grants.sql`
   - `supabase/migrations/20261021130000_t025_health_tables_private.sql`
   - `supabase/migrations/20261021150000_t053_users_private.sql`
2. Los archivos tienen `BEGIN/COMMIT`; no usar `supabase db push` ciego porque el SQL de auth queda fuera de `migrations`.
3. Si un preflight detecta huérfanos o constraints desconocidos, abortar sin borrar datos.
4. M4/M5 privatizan las 6 tablas de salud y `users`; los clientes legacy con anon necesitan identidad/política dedicada. No poner service key en clientes. Esos clientes quedan fuera de alcance.

Los fixtures SQL locales prueban semántica con roles reales en PostgreSQL local, pero **no equivalen a la verificación remota**: constraints y políticas RLS reales siguen sin inspección completa por metadata REST.

## Vinculación Auth

- Las 5 identidades sin `app_metadata.role` ni `app_user_id` necesitan provisioning administrado explícito.
- Buscar el `UserID` existente y vincular sin inferir nombres ni identidades.
- Conservar los 17 hashes bcrypt coste 10.
- Los 4 hashes no-bcrypt fallan cerrado; el reset es manual y autorizado, sin adivinar algoritmo.
- El rol de DB se aplica al cargar usuario; la metadata debe alinearse con el adaptador actual.

## Verificación posterior

- Login email/username: 401 credencial inválida, 403 permiso, 409 borrado con datos.
- Cookie HttpOnly/Secure en producción; sesión y logout; CSRF mismo origen.
- La validación local ya pasó: calendario 1/1, 2 backend real y 10 mock, 0 fallos/skips; no repetir Node 15/Postman 22.
- No afirmar usuarios live hasta aplicar migraciones y vinculaciones.

## Rollback

El rollback de Vercel revierte la app, no el SQL ni la privacidad. No reabrir anon ni borrar tablas automáticamente. Un rollback de aplicación no deshace migraciones ya aplicadas.

## Pendientes explícitos

- Migraciones SQL y provisioning Auth en staging. No aplicadas en remoto.
- Variables de Preview/Production y verificación HTTP real contra staging.
- Release `codex/release/0.2.0` preparada (HEAD `50f950e`, versión `0.2.0`); publicación remota pendiente. No main/push/deploy automático.
- `progress.txt` de 0 bytes no es documentación ni se versiona.
