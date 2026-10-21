import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import { toActiveActor, toPublicSession } from "@/server/domain/session";
import type { ActiveActor } from "@/server/domain/user";
import { UnauthorizedError } from "@/server/domain/errors";
import { buildClearedSessionCookie, buildSessionCookie } from "../cookies";
import { handle, jsonResult, parseInput, type HttpResult } from "../problem";
import { loginBodySchema } from "../schemas/auth";

export interface AuthHttpOptions {
  readonly secureCookies: boolean;
}

export interface AuthHttpHandlers {
  login(input: { body: unknown }): Promise<HttpResult>;
  session(input: { sessionToken: string | undefined }): Promise<HttpResult>;
  logout(input: { sessionToken: string | undefined }): Promise<HttpResult>;
}

function requireToken(sessionToken: string | undefined): string {
  if (sessionToken === undefined || sessionToken.length === 0) {
    throw new UnauthorizedError();
  }
  return sessionToken;
}

export async function requireActor(
  auth: AuthUseCases,
  sessionToken: string | undefined,
): Promise<ActiveActor> {
  const session = await auth.getSession(requireToken(sessionToken));
  return toActiveActor(session);
}

export function createAuthHttpHandlers(
  auth: AuthUseCases,
  options: AuthHttpOptions,
): AuthHttpHandlers {
  return {
    async login(input): Promise<HttpResult> {
      return handle(async () => {
        const body = parseInput(loginBodySchema, input.body);
        const command =
          "email" in body
            ? ({ kind: "email", email: body.email, password: body.password } as const)
            : ({
                kind: "username",
                username: body.username,
                password: body.password,
              } as const);
        const session = await auth.login(command);
        return jsonResult(
          200,
          toPublicSession(session),
          undefined,
          [buildSessionCookie(session.token, session.expiresAt, options.secureCookies)],
        );
      });
    },

    async session(input): Promise<HttpResult> {
      return handle(async () => {
        const session = await auth.getSession(requireToken(input.sessionToken));
        return jsonResult(
          200,
          toPublicSession(session),
          undefined,
          [buildSessionCookie(session.token, session.expiresAt, options.secureCookies)],
        );
      });
    },

    async logout(input): Promise<HttpResult> {
      return handle(async () => {
        if (input.sessionToken !== undefined && input.sessionToken.length > 0) {
          try {
            await auth.logout(input.sessionToken);
          } catch {
            // Logout is idempotent: an invalid/expired session still clears the
            // browser cookie. No token or upstream error is exposed.
          }
        }
        return jsonResult(204, undefined, undefined, [
          buildClearedSessionCookie(options.secureCookies),
        ]);
      });
    },
  };
}
