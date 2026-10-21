import { z } from "zod";
import {
  AppError,
  ValidationError,
} from "@/server/domain/errors";
import type { HttpCookie } from "./cookies";

export interface ProblemBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export interface HttpResult {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly cookies?: readonly HttpCookie[];
}

export function jsonResult(
  status: number,
  body?: unknown,
  headers?: Readonly<Record<string, string>>,
  cookies?: readonly HttpCookie[],
): HttpResult {
  return {
    status,
    ...(body === undefined ? {} : { body }),
    ...(headers === undefined ? {} : { headers }),
    ...(cookies === undefined ? {} : { cookies }),
  };
}

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    throw new ValidationError("La petición no cumple el contrato", { issues });
  }
  return result.data;
}

export function toProblem(error: unknown): HttpResult {
  if (error instanceof AppError) {
    const body: ProblemBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
    return jsonResult(error.statusCode, body, {
      "Content-Type": "application/problem+json",
    });
  }

  // Never expose stack traces, database errors or secret values to clients.
  const body: ProblemBody = {
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor",
    },
  };
  return jsonResult(500, body, { "Content-Type": "application/problem+json" });
}

export async function handle(
  operation: () => Promise<HttpResult>,
): Promise<HttpResult> {
  try {
    return await operation();
  } catch (error) {
    return toProblem(error);
  }
}
