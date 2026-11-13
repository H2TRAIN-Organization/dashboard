import type { UserRole } from "@/server/domain/user";

/**
 * Puerto del alta de identidades en GoTrue (MT49).
 *
 * La creación de usuarios por admin crea primero la identidad en Supabase
 * Auth (email + contraseña + vínculo app_metadata) y después la fila en
 * public.users. El email se deduce del username con las mismas reglas que el
 * script de siembra MT45 (username-as-email o dominio sintético `.invalid`).
 */
export interface AuthIdentityAdmin {
  /**
   * Crea la identidad de GoTrue confirmada (email_confirm=true) con
   * `{ app_user_id, role }` en app_metadata. Falla si el email ya está en uso.
   */
  createIdentity(input: {
    email: string;
    password: string;
    appUserId: number;
    role: UserRole;
  }): Promise<void>;
}
