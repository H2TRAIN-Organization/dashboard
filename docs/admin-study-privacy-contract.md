# Contrato de implementación: administración, estudio y privacidad

Base: release `007a983`; rama `codex/feature/admin-study-privacy`.
No push, despliegue, migraciones remotas ni modificación de datos reales.
Conservar `progress.txt` preexistente. Sin dependencias nuevas salvo necesidad
justificada. Todo resultado debe estar comprobado, con secretos fuera de logs.

## Propiedad y contratos comunes

- Coordinador: `api-types.ts`, `api-client.ts`, `translations.ts`, OpenAPI,
  colecciones/simulaciones Postman, navegación compartida y pruebas integradas.
- Privacidad: dominio/sesión/auth y persistencia asociada, boundary/layout,
  rutas `/privacy`, `/api/privacy/status`, `/api/privacy/decision`, política
  localizada propia, migración y pruebas de esta área. También el guard en
  `http/handlers/auth.ts` y `composition/kubios-runtime.ts` existente.
- Kubios/Estudio: nuevas rutas/admin Kubios y runtime propio separado,
  lectura paginada de vínculos/snapshots, páginas Kubios admin, Estudio,
  StudyCharts y normalización, rango 365d en dominio/esquema, SQL y pruebas.
- Base de datos: admin/database, repositorio/puerto/casos de uso/dominio/http
  de admin database y sus rutas, módulo de copia/exportación y pruebas propias.

No editar archivos propiedad de otro: proponer cambios al coordinador. Nuevos
DTO/API client y diccionarios de área pueden estar en módulos separados para
trabajar en paralelo sin tocar los tres archivos compartidos.

## Interfaces

- Privacidad: estado `initial | banner | complete` por sesión y versión;
  primer accept permite acceso a datos; segundo accept oculta barra.
  Reject revoca sesión terminalmente y registra en transacción. Solo banner
  exige confirmación UI. Registrar idioma, versión/hash, decisión/hora servidor
  e idempotencia. No tocar GDPRConsent ni importaciones/consentimiento externo.
  `GET /api/privacy/status`, `POST /api/privacy/decision` con
  `{ policyVersion, surface: 'login'|'banner', decision:'accept'|'reject',
  language:'es'|'en', requestId }`. Version obsoleta 409; pendiente de primer
  aviso: 403 `PRIVACY_ACTION_REQUIRED`. PublicSession puede añadir `privacy`;
  ausencia equivale a initial, nunca autorización implícita. El guard común
  exportado por el área privacidad debe ser reutilizado por rutas nuevas.
  Política pública sin gate; contactos/estado propio disponibles desde allí.
- Kubios admin: `/api/admin/kubios/participants` lista paginada por UserID,
  búsqueda, from/to, page/pageSize; solo admin. Detalle/history/export por
  `/api/admin/kubios/participants/[userId]` (subrutas si conviene).
  Resolver usuario->vínculo verificado->snapshot cacheado. Admin sin vínculo
  propio también puede consultar. Nunca ampliar endpoints personales.
  Exportar desde runtime `readAllAdminKubios(actor)` para copia lógica:
  filas vinculadas identificadas por userId y resultados saneados, sin tokens
  ni claves; fallar si lectura incompleta. Anunciar firma exacta al coordinador.
- Estudio usa periodos tipados 7d/30d/90d/365d/all; correlaciones persona+día
  UTC, agregación previa, tamaño muestra, sin causas ni datos inventados.
  Admin integra Kubios; doctor conserva datos diabetes sin acceso global Kubios.
- Base datos: ampliar paginación con offset o cursor y orden por PK, sin romper
  limit actual. Reusar allowlist y mapeadores saneados. Exportación completa,
  nunca solo primera página. Copia lógica versionada cifrada por contraseña
  elegida para descarga, manifiesto: usuarios, salud y Kubios vinculado.
  No incluye sesiones, contraseñas/hashes, tokens, claves ni esquema de BD.
  No presentar copia lógica como backup completo de PostgreSQL. Coordinar
  dependencia con runtime Kubios; no introducir fallback que omita Kubios.

## Política confirmada

Borrador ES/EN. Responsable Universidad de Las Palmas de Gran Canaria;
contacto htrain@proton.me (no afirmar DPD); finalidad dashboard de tratamiento
y consulta de datos médicos/Kubios; consentimiento explícito externo como base
indicada por usuario; conservación un año desde recogida. Texto debe explicar
derechos/contacto y separación entre lectura/acceso y consentimiento externo.
Proveedores conocidos Supabase/Vercel/Kubios, condiciones y transferencias
pendientes de verificar antes de declarar texto definitivo. Sin afirmar
conformidad jurídica absoluta ni borrado automático no implementado.

## Validación y entrega

Pruebas unitarias/contratos, APIs reales con dependencia Supabase simulada,
Playwright escritorio/móvil, SQL aislado, check/build/regresión Kubios.
Coordinador integra; validador y security-reviewer independientes revisan el
cambio integrado y parches. No escrituras en Tanausú por subagentes.
