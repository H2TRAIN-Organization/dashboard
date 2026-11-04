import { UnauthorizedError, ValidationError } from "@/server/domain/errors";
import type { Session } from "@/server/domain/session";
import { USERNAME_MAX_LENGTH } from "@/server/domain/user";
import type { AuthGateway } from "../ports/auth-gateway";

export type LoginCommand =
  | { readonly kind: "email"; readonly email: string; readonly password: string }
  | { readonly kind: "username"; readonly username: string; readonly password: string };

export interface AuthUseCases {
  login(command: LoginCommand): Promise<Session>;
  getSession(token: string): Promise<Session>;
  logout(token: string): Promise<void>;
}

async function revokeQuietly(auth: AuthGateway, token: string): Promise<void> {
  try {
    await auth.revokeSession(token);
  } catch {
    // The login is denied/kept independently of cleanup; the orphan session
    // still expires at its original timestamp.
  }
}

export function createAuthUseCases(auth: AuthGateway): AuthUseCases {
  return {
    async login(command: LoginCommand): Promise<Session> {
      if (command.password.length === 0) {
        throw new ValidationError("La contraseña es obligatoria");
      }

      let session: Session | null;

      if (command.kind === "username") {
        const username = command.username.trim();
        if (username.length === 0) {
          throw new ValidationError("El nombre de usuario es obligatorio");
        }
        if (username.length > USERNAME_MAX_LENGTH) {
          throw new ValidationError(
            `El nombre de usuario no puede superar ${USERNAME_MAX_LENGTH} caracteres`,
          );
        }
        session = await auth.authenticateByUsername(username, command.password);
      } else {
        const identifier = command.email.trim();
        if (identifier.length === 0) {
          throw new ValidationError("El identificador es obligatorio");
        }
        session = await auth.authenticateByEmail(identifier, command.password);

        if (identifier.length <= USERNAME_MAX_LENGTH) {
          // A legacy Username may look like an email (even with a non-ASCII
          // local part). Check the legacy store explicitly so:
          // - an email-shaped legacy account can still authenticate when no
          //   Supabase identity matches;
          // - an identifier that authenticates against two different users is
          //   denied as ambiguous instead of silently choosing one role.
          // Infrastructure/configuration errors from the email path are not
          // caught here: they fail closed.
          const hasLegacy = await auth.hasLegacyUsername(identifier);
          if (hasLegacy) {
            const legacySession = await auth.authenticateByUsername(
              identifier,
              command.password,
            );
            if (session !== null && legacySession !== null) {
              if (session.user.id !== legacySession.user.id) {
                await revokeQuietly(auth, session.token);
                await revokeQuietly(auth, legacySession.token);
                throw new UnauthorizedError("Credenciales inválidas");
              }
              // Same user; keep the email session and discard the duplicate.
              await revokeQuietly(auth, legacySession.token);
            } else if (session === null) {
              session = legacySession;
            }
          }
        }
      }

      if (session === null) {
        throw new UnauthorizedError("Credenciales inválidas");
      }
      // The gateway reports the credential that actually authenticated. Do not
      // relabel a username fallback as an email session.
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
