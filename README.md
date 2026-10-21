# Diabetes Tracker Dashboard

Dashboard de administración para Diabetes Tracker, construido con Next.js, React, Tailwind CSS y Supabase. Este README describe alcance, puesta en marcha y convenciones de trabajo. El estado detallado, las evidencias y los bloqueos se mantienen en `docs/registro-tareas.md`. No certifica que la implementación esté terminada ni que las pruebas pasen.

## Alcance

**Incluido (objetivo)**

- Dashboard Next.js y su frontend actual.
- Supabase como persistencia y autenticación.
- Backend integrado en Next.js (App Router), con arquitectura y contratos verificables.
- Administración completa: usuarios, roles y base de datos.
- Dos accesos: email/password con Supabase Auth y usuario/password con verificación de hash en servidor.
- Roles `admin`, `doctor` y `user`.

**Excluido estrictamente**

- `pi-mqtt-agent/`
- `kub-kubioscloud-demo/` y toda la integración Kubios: `src/app/kubios`, `src/app/api/kubios`, `src/lib/kubios-service.ts` y variables `KUBIOS_*`.
- `Uploader/`
- Publicación y despliegue: no deploy, no push a producción, no publicación de paquetes.

**Reglas de diseño**

- Preservar el diseño y la experiencia visual del frontend; adaptar solo conexiones, contratos y capa de datos.
- `admin`: gestión completa de usuarios, roles y base de datos.
- `doctor`: lectura global de usuarios y datos.
- `user`: lectura de sus propios datos.
- Borrado de usuario: bloquear con error explícito si existen registros asociados (409). El mecanismo exacto debe verificarse en Supabase; no se inventa.

Estas reglas son el objetivo de la reconstrucción, no comportamiento verificado del código legado.

## Requisitos y puesta en marcha

Requisitos:

- Node.js y npm. No hay `engines` en `package.json`; verifica la compatibilidad con la versión de Next.js instalada.
- Git.
- Proyecto Supabase de desarrollo o staging. No uses producción para pruebas destructivas.

```bash
npm install
```

Copia la plantilla de entorno y sustituye los placeholders:

```bash
# macOS/Linux
cp .env.example .env.local

# PowerShell
Copy-Item .env.example .env.local
```

Edita `.env.local` con valores propios y ejecuta:

```bash
npm run dev
```

Abre `http://localhost:3000`.

Scripts disponibles en `package.json`:

```bash
npm run build
npm run typecheck
npm run typecheck:app
npm run lint
npm run test
npm run test:e2e
npm run check
```

La existencia de estos scripts no implica que pasen. Los resultados y bloqueos se registran en `docs/registro-tareas.md`; este README no declara PASS.

`.gitignore` ya incluye la excepción `!.env.example`; la plantilla no está ignorada. No se ha staged ni commiteado. No se fuerza staging desde documentación.

## Variables de entorno

No se copian valores reales en este README ni en `.env.example`. La plantilla contiene únicamente placeholders.

| Variable | Ámbito | Uso |
| --- | --- | --- |
| `SUPABASE_URL` | Servidor (preferido) | URL del proyecto Supabase. No se duplica como `NEXT_PUBLIC_SUPABASE_URL` si todo el acceso pasa por servidor. |
| `SUPABASE_PUBLISHABLE_KEY` | Público/servidor | Clave publicable; no es un secreto, pero exige RLS y grants correctos. |
| `SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SECRET_KEY` | Solo servidor | Clave privada para operaciones administrativas. Preferir `SUPABASE_SERVICE_ROLE_KEY`; `SUPABASE_SECRET_KEY` solo se acepta si su claim es `service_role`. Una clave `anon` no habilita OpenAPI. Nunca exponerla ni prefijarla con `NEXT_PUBLIC_`. |
| `ENCRYPTION_SECRET_KEY` | Solo servidor | Clave de cifrado actual. El algoritmo, los IV y el esquema real no están verificados. |
| `ENCRYPTION_SECRET_KEY0` | Solo servidor | Clave anterior, solo si se aplica rotación. No verificada. |
| `AUTH_SESSION_SECRET` | Solo servidor | Secreto de firma de sesiones; obligatorio en producción (32+ bytes aleatorios). No generar ni escribir claves reales en este repositorio. |
| `AUTH_SESSION_TTL_SECONDS` | Solo servidor | TTL de sesión en segundos; el runtime aplica un valor por defecto si falta o es inválido. |
| `AUTH_LOGIN_WINDOW_SECONDS` | Solo servidor | Ventana del rate limit de login, en segundos. |
| `AUTH_LOGIN_MAX_ATTEMPTS` | Solo servidor | Intentos máximos de login por ventana. |
| `AUTH_LOGIN_BLOCK_SECONDS` | Solo servidor | Duración del bloqueo tras superar intentos. |

Notas:

- `.env.local` está ignorado por `.gitignore`.
- No se incluye `NEXT_PUBLIC_BACKEND_URL`: es un endpoint heredado en retirada. Tampoco se incorporan los endpoints `fix-ids`/`sync-auth`.
- No se verificó que estas variables sean suficientes ni que coincidan con el entorno real.
- Los prerrequisitos y pendientes de Supabase están en `docs/supabase-setup.md`; no implican cambios remotos aplicados.

## Supabase: acceso y datos

- PostgREST usa por defecto el perfil `api`. Para las tablas del proyecto, fijar explícitamente `Accept-Profile: public`; sin ese header, una consulta a `users` puede devolver 404.
- Nombres físicos observados en el esquema `public`: `users`, `insulindata`, `fooddata`, `exercisedata`, `periodrecords`, `mooddata` y `polar_data`. No usar los alias con guion bajo sin verificarlos.
- Tipos, nulabilidad, defaults, PK/FK, unique, índices y políticas RLS no están verificados. Requieren SQL read-only o una clave `service_role` real; OpenAPI no es accesible solo con la publishable.
- RLS y grants deben impedir que la clave publishable lea `users.PasswordHash`; se observó lectura permitida y es un riesgo a corregir. No se copian hashes.
- No asumir algoritmo, IV, encoding ni rotación del cifrado; el esquema real sigue pendiente.
- Borrar un usuario con registros de salud asociados debe devolver 409 y no borrar datos ni identidad de Auth.
- Prerrequisitos conocidos y pendientes de migraciones/vinculación Auth: `docs/supabase-setup.md`. No se declaran aplicados.

Consultas de inspección, solo lectura y en staging:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r';

select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public';
```

No ejecutes scripts de seed, borrado o escritura contra producción. Los scripts de `scripts/` son manuales y no constituyen una suite de regresión verificada.

## Autenticación y autorización

**Objetivo**

- Mantener los dos accesos: email/password con Supabase Auth y usuario/password con verificación de hash en servidor.
- El hash nunca debe salir del servidor ni llegar al navegador.
- La sesión debe usar cookies `HttpOnly`, `Secure` y `SameSite` adecuadas, sin token JSON accesible desde JavaScript.
- La identidad no debe confiarse desde `localStorage`.
- Los roles y permisos deben aplicarse en el servidor en cada caso de uso, no solo en guards de UI.
- `admin` gestiona usuarios y base de datos; `doctor` tiene lectura global; `user` solo accede a sus propios datos.
- El borrado de usuarios con registros asociados debe bloquearse.

El código legado no es referencia de autenticación; sus riesgos y el estado de corrección están en `docs/registro-tareas.md`.

## Git Flow y trabajo paralelo

- `main`: rama estable/producción. Solo recibe merges desde `codex/release/*` después de validación.
- `dev`: rama de integración.
- `codex/feature/<slug>`: una rama por frente, creada desde `dev`.
- `codex/release/<version>`: rama de release, creada desde `dev`.
- Base autorizada: `dev`. No se incorpora `main` ni los endpoints heredados `fix-ids`/`sync-auth`.
- El trabajo paralelo se organiza en worktrees aislados con propiedad de archivos delimitada. Los frentes no commitean hasta validación; solo foundation tiene permiso de commit de sus propios archivos.
- Los commits y merges se serializan. El merge se hace con `git merge --no-ff` una vez validado el cambio.
- No se permite commit directo a `dev` o `main`.
- Commits con Conventional Commits: `feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, `test(scope): ...`, `chore(scope): ...`.
- Este alcance no incluye publicación ni deploy.

El documentador no ejecuta `git checkout`, `add`, `commit`, `merge` ni `push`.

## Estado y evidencia

El estado por tarea, las sesiones, los commits, las evidencias readonly, los límites y los bloqueos se mantienen en `docs/registro-tareas.md`. Los prerrequisitos y pendientes de Supabase están en `docs/supabase-setup.md`. No se declara terminada la implementación ni se afirma que las pruebas hayan pasado.

## Estructura

```text
dashboard/
├── contracts/               # contrato OpenAPI
├── docs/
│   ├── registro-tareas.md
│   └── supabase-setup.md
├── public/
├── scripts/                 # scripts manuales
├── src/
│   ├── app/                 # páginas y rutas API de Next.js
│   ├── components/
│   ├── contexts/
│   ├── hooks/
│   ├── lib/
│   └── server/              # domain/application/infrastructure/http/composition
├── tests/                   # pruebas en frentes paralelos
├── .env.example             # plantilla de entorno; sin staging
├── package.json
└── README.md
```

Directorios excluidos y no editados en este alcance: `pi-mqtt-agent/`, `kub-kubioscloud-demo/` y `Uploader/`.

## Licencia

MIT, según la versión anterior de este README. No se localizó un archivo `LICENSE` en la raíz.
