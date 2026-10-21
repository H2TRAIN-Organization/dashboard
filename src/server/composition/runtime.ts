import "server-only";

import { ServiceUnavailableError } from "@/server/domain/errors";
import type { ServerApplication } from "./container";

export type ServerRuntimeFactory = () => ServerApplication | Promise<ServerApplication>;

let runtimeFactory: ServerRuntimeFactory | null = null;

/**
 * Integration point for the auth and persistence agents. The Next route layer
 * calls getServerRuntime(); until a real factory is registered, API routes fail
 * closed with 503 instead of serving fixtures.
 */
export function registerServerRuntime(factory: ServerRuntimeFactory): void {
  runtimeFactory = factory;
}

export function isServerRuntimeRegistered(): boolean {
  return runtimeFactory !== null;
}

export async function getServerRuntime(): Promise<ServerApplication> {
  if (runtimeFactory === null) {
    throw new ServiceUnavailableError(
      "El runtime del backend no está configurado",
    );
  }
  return runtimeFactory();
}
