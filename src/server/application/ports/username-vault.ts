/**
 * Puerto del cifrado de usernames (MT46/MT47).
 *
 * El nombre de usuario vive cifrado en `public.users` con Vault; el cliente
 * PostgREST nunca ve el material de clave y solo accede a las RPCs
 * `auth_username_*` con service_role. La implementación degrada de forma
 * explícita mientras la migración no esté aplicada (fallback a la columna
 * legacy "Username"), y ese fallback se retira en el cutover de MT48.
 */
export interface UsernameVault {
  /**
   * Resuelve el username normalizado a su UserID canónico (string) usando el
   * HMAC server-side. Devuelve null si no existe o si la migración aún no está
   * aplicada; lanza PersistenceError("USERNAME_AMBIGUOUS") ante ambigüedad.
   */
  resolveUserIdByUsername(username: string): Promise<string | null>;

  /**
   * Descifra los usernames de un lote de usuarios (una consulta por página).
   * Los IDs sin fila o sin datos descifrables se omiten del mapa.
   */
  displayNames(userIds: readonly string[]): Promise<Map<string, string>>;

  /**
   * Cifra y persiste el username de una cuenta (alta o cambio). Devuelve false
   * únicamente cuando la migración de Vault aún no está aplicada; los demás
   * errores se propagan.
   */
  mirrorUsername(userId: string, username: string): Promise<boolean>;
}
