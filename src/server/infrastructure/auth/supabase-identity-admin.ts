import type { AuthIdentityAdmin } from "@/server/application/ports/auth-identity-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/server/domain/user";

import { ConflictError, ServiceUnavailableError } from "@/server/domain/errors";

/**
 * Adaptador oficial de Supabase Auth para el puerto AuthIdentityAdmin (MT49).
 *
 * Usa el cliente service_role existente. La identidad se crea confirmada
 * (`email_confirm: true`, cuentas gestionadas por admin) con el vínculo
 * `{ app_user_id, role }` en app_metadata, que es lo que el gateway de auth
 * exige para emitir sesiones. La contraseña la hashea GoTrue: nunca se
 * guarda ni se registra.
 */
export class SupabaseAuthIdentityAdmin implements AuthIdentityAdmin {
  constructor(private readonly client: SupabaseClient) {}

  async createIdentity(input: {
    email: string;
    password: string;
    appUserId: number;
    role: UserRole;
  }): Promise<void> {
    const { error } = await this.client.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: {
        app_user_id: input.appUserId,
        role: input.role,
      },
    });
    if (error === null) {
      return;
    }
    const message = error.message.toLowerCase();
    if (
      message.includes("already") ||
      message.includes("registered") ||
      message.includes("exists")
    ) {
      throw new ConflictError(
        "CONFLICT",
        "El email derivado del nombre de usuario ya está registrado en Supabase Auth.",
      );
    }
    throw new ServiceUnavailableError(
      "Supabase Auth rechazó la creación de la identidad.",
    );
  }
}
