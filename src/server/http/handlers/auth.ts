import type { AuthUseCases } from "@/server/application/auth/auth-use-cases";
import type { ActiveActor } from "@/server/domain/user";
import { toActiveActor } from "@/server/domain/session";
import { getBearerToken, handle, jsonResult, parseInput, type HttpResult } from "../problem";
import { loginBodySchema } from "../schemas/auth";

export interface AuthHttpHandlers {
  login(input: { body: unknown }): Promise<HttpResult>;
  session(input: { authorization: string | undefined }): Promise<HttpResult>;
  logout(input: { authorization: string | undefined }): Promise<HttpResult>;
}

export async function requireActor(
  auth: AuthUseCases,
  authorization: string | undefined,
): Promise<ActiveActor> {
  const session = await auth.getSession(getBearerToken(authorization));
  return toActiveActor(session);
}

export function createAuthHttpHandlers(auth: AuthUseCases): AuthHttpHandlers {
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
        return jsonResult(200, session);
      });
    },

    async session(input): Promise<HttpResult> {
      return handle(async () => {
        const token = getBearerToken(input.authorization);
        const session = await auth.getSession(token);
        return jsonResult(200, session);
      });
    },

    async logout(input): Promise<HttpResult> {
      return handle(async () => {
        const token = getBearerToken(input.authorization);
        await auth.logout(token);
        return jsonResult(204);
      });
    },
  };
}
