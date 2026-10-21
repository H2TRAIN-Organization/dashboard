import { randomBytes } from "node:crypto";
import type {
  PasswordVerification,
  PasswordVerifier,
} from "./contracts";

/**
 * Minimal surface of bcryptjs / bcrypt. The integrator installs one of them;
 * this module never installs or imports the dependency itself.
 */
export interface BcryptLibrary {
  compare(data: string, encrypted: string): Promise<boolean>;
  hash(data: string, saltOrRounds: number): Promise<string>;
}

export interface BcryptPasswordVerifierOptions {
  /**
   * Observed legacy hashes use bcrypt $2b$ cost 10. Costs above this limit are
   * rejected instead of allowing a hostile hash to consume arbitrary CPU.
   */
  readonly maxCost?: number;
  readonly dummyCost?: number;
}

// Valid bcrypt hash of a throwaway value, used only if the injected library
// cannot generate the per-process dummy hash. It is not a real user credential.
const FALLBACK_DUMMY_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const BCRYPT_PATTERN = /^\$2([aby])\$(\d{2})\$[./A-Za-z0-9]{53}$/;

function parseCost(passwordHash: string): number | null {
  const match = BCRYPT_PATTERN.exec(passwordHash);
  if (match === null) {
    return null;
  }
  const costText = match[2];
  if (costText === undefined) {
    return null;
  }
  const cost = Number.parseInt(costText, 10);
  return Number.isInteger(cost) ? cost : null;
}

/**
 * Verifies legacy bcrypt hashes without rehashing. The algorithm version and
 * cost in the stored hash are preserved; successful logins never mutate the
 * stored credential.
 */
export function createBcryptPasswordVerifier(
  bcrypt: BcryptLibrary,
  options: BcryptPasswordVerifierOptions = {},
): PasswordVerifier {
  if (
    bcrypt === null ||
    typeof bcrypt.compare !== "function" ||
    typeof bcrypt.hash !== "function"
  ) {
    throw new Error(
      "Se requiere una biblioteca bcrypt con compare()/hash() (por ejemplo bcryptjs)",
    );
  }

  const maxCost = options.maxCost ?? 14;
  const dummyCost = Math.min(
    Math.max(options.dummyCost ?? 10, 4),
    Math.max(maxCost, 4),
  );
  let dummyHash: Promise<string> | null = null;

  function getDummyHash(): Promise<string> {
    if (dummyHash === null) {
      dummyHash = bcrypt
        .hash(randomBytes(32).toString("hex"), dummyCost)
        .catch(() => FALLBACK_DUMMY_HASH);
    }
    return dummyHash;
  }

  return {
    async verify(password: string, passwordHash: string): Promise<PasswordVerification> {
      if (typeof passwordHash !== "string" || passwordHash.length === 0) {
        return { ok: false, cost: null, reason: "missing" };
      }
      const cost = parseCost(passwordHash);
      if (cost === null) {
        return { ok: false, cost: null, reason: "malformed" };
      }
      if (cost < 4 || cost > maxCost) {
        return { ok: false, cost, reason: "unsupported_cost" };
      }
      try {
        const ok = await bcrypt.compare(password, passwordHash);
        return {
          ok,
          cost,
          reason: ok ? "ok" : "mismatch",
        };
      } catch {
        return { ok: false, cost, reason: "verification_error" };
      }
    },

    async verifyDummy(password: string): Promise<void> {
      try {
        const hash = await getDummyHash();
        await bcrypt.compare(password, hash);
      } catch {
        // Constant-work mitigation is best effort; the caller still rejects.
      }
    },
  };
}
