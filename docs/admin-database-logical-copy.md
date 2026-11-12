# Copia lógica y exportación de administración

La pantalla `/admin/database` permite recorrer tablas por clave primaria,
exportar una tabla completa en CSV/JSON y descargar una copia lógica cifrada.
Las APIs requieren sesión admin y primer aviso de privacidad aceptado. No
aceptan SQL ni nombres fuera de la allowlist existente.

La copia incluye `users`, `insulindata`, `fooddata`, `exercisedata`,
`periodrecords`, `mooddata`, `polar_data` y Kubios vinculado por `userId`.
El manifiesto contiene versión, fecha de creación, alcance y recuentos.
Se usan las proyecciones/mapeadores saneados existentes; se eliminan también
campos anidados con nombres de credenciales. No incluye sesiones, hashes,
contraseñas, tokens, claves ni esquema. No es un backup completo de PostgreSQL
ni contiene una función automática de restauración.

La lectura usa páginas ordenadas por PK con recuentos exactos. Una página corta,
PK repetida/desordenada, cambio de recuento, tabla no disponible o error Kubios
impide generar la copia. Es una lectura paginada y no una instantánea
transaccional: cambios concurrentes que conservan recuentos pueden no detectarse.
Las descargas se preparan completas en memoria; tamaños máximos prácticos
dependen de memoria y límites de respuesta/tiempo del hosting. No se truncan
deliberadamente a 1000 registros. CSV neutraliza fórmulas de hoja de cálculo.

Para utilizar la copia en recuperación, generarla en una ventana sin escrituras
de otras aplicaciones o administradores. Un borrado y una inserción concurrentes
que mantengan el recuento pueden provocar omisiones no detectadas por el lector
paginado. El manifiesto declara expresamente que no es una instantánea
transaccional; no sustituye un respaldo transaccional de PostgreSQL.

El usuario elige una contraseña de 12–1024 caracteres para cada descarga.
No se registra ni almacena. Se deriva una clave de 32 bytes con scrypt
`N=131072,r=8,p=1`, salt aleatoria de 32 bytes; AES-256-GCM usa nonce aleatorio
de 12 bytes y tag de 16 bytes. Los metadatos del formato están autenticados
como AAD. El archivo exterior solo contiene el formato y parámetros públicos
de cifrado; el manifiesto y los datos están dentro del contenido cifrado.

## Recuperación local

Con Node.js del proyecto, desde un terminal interactivo:

```powershell
node scripts/decrypt-logical-copy.mjs "C:\descargas\logical-copy.encrypted.json" "C:\privado\recovered.json"
```

El comando pide la contraseña sin mostrarla y no la acepta como argumento.
Comprueba autenticidad antes de crear salida, se niega a sobrescribir un archivo
existente y no contacta servicios ni modifica la BD. Una contraseña errónea o
archivo alterado provoca un fallo sin crear salida. El resultado recuperado
contiene datos médicos en texto claro: guárdalo fuera del repositorio y limita
su acceso. La pérdida de la contraseña impide recuperar esta copia.

## Contrato HTTP

- `GET /api/admin/database/table-data?table=users&limit=100&offset=100`:
  página, recuento total, `offset` y `hasMore`; `limit` previo se conserva.
- `GET /api/admin/database/tables`: `observedAt` y estado
  `complete|partial|failed`, calculado desde disponibilidad real.
- `GET /api/admin/database/export?table=users&format=json` (o `csv`).
- `POST /api/admin/database/logical-backup` con JSON `{ "password": "..." }`.

Exportación y copia devuelven JSON `{success, filename, contentType, content}`;
el cliente convierte el contenido en archivo local. La contraseña solo se envía
en cuerpo POST y nunca en query. Todas las respuestas usan `private, no-store`
mediante el adaptador común; POST aplica protección CSRF común.
