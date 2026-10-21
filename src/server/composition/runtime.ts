import "server-only";

import type { ServerApplication } from "./container";
import {
  createProductionServerRuntime,
  toRuntimeUnavailableError,
} from "./production";

export type ServerRuntimeFactory = () => ServerApplication | Promise<ServerApplication>;

/**
 * Explicit test/integration override. It always wins over the production
 * default and is never replaced by it. Production code does not register it.
 */
let runtimeFactory: ServerRuntimeFactory | null = null;

/**
 * One application/client graph per process. It contains no actor, session or
 * user-specific data; requests still reload roles and revocation from the
 * database. Concurrent callers share the same initialization promise.
 */
let productionRuntimePromise: Promise<ServerApplication> | null = null;

export function registerServerRuntime(factory: ServerRuntimeFactory): void {
  runtimeFactory = factory;
}

/**
 * True only when an explicit override was registered. The production default
 * is available lazily without registration.
 */
export function isServerRuntimeRegistered(): boolean {
  return runtimeFactory !== null;
}

function getProductionRuntime(): Promise<ServerApplication> {
  if (productionRuntimePromise === null) {
    productionRuntimePromise = Promise.resolve()
      .then(() => createProductionServerRuntime())
      .catch((error: unknown) => {
        // A failed construction (missing env/key) must not poison the process:
        // a later request retries and can succeed after configuration changes.
        productionRuntimePromise = null;
        throw toRuntimeUnavailableError(error);
      });
  }
  return productionRuntimePromise;
}

export async function getServerRuntime(): Promise<ServerApplication> {
  const override = runtimeFactory;
  if (override !== null) {
    return override();
  }
  return getProductionRuntime();
}
