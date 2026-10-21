import { UnauthorizedError, ValidationError } from "@/server/domain/errors";
import type { Session } from "@/server/domain/session";
import type { AuthGateway } from "../ports/auth-gateway";

export type LoginCommand =
  | { readonly kind: "email"; readonly email: string; readonly password: string }
  | { readonly kind: "username"; readonly username: string; readonly password: string };

export interface AuthUseCases {
  login(command: LoginCommand): Promise<Session>;
  getSession(token: string): Promise<Session>;
  logout(token: string): Promise<void>;
}

export function createAuthUseCases(auth: AuthGateway): AuthUseCases {
  return {
    async login(command: LoginCommand): Promise<Session> {
      if (command.password.length === 0) {
        throw new ValidationError("La contraseña es obligatoria");
      }

      const session =
        command.kind === "email"
          ? await auth.authenticateByEmail(command.email, command.password)
          : await auth.authenticateByUsername(command.username, command.password);

      if (session === null) {
        throw new UnauthorizedError("Credenciales inválidas");
      }
      return session;
    },

    async getSession(token: string): Promise<Session> {
      if (token.length === 0) {
        throw new UnauthorizedError();
      }
      const session = await auth.getSession(token);
      if (session === null) {
        throw new UnauthorizedError("Sesión inválida o caducada");
      }
      return session;
    },

    async logout(token: string): Promise<void> {
      if (token.length > 0) {
        await auth.revokeSession(token);
      }
    },
  };
}
