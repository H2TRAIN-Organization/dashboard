import { PersistenceError } from "../errors";

/**
 * Structural subset of `bcrypt`/`bcryptjs`. The integrator must add one of
 * those libraries and pass the module to `createBcryptPasswordHasher`.
 */
export interface BcryptLike {
  hash(data: string, saltOrRounds: number | string): Promise<string>;
  compare?(data: string, encrypted: string): Promise<boolean>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
}

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(value: unknown): value is string {
  return typeof value === "string" && value.length === 60 && BCRYPT_HASH.test(value);
}

export function assertBcryptHash(value: unknown): asserts value is string {
  if (!isBcryptHash(value)) {
    throw new PersistenceError(
      "PASSWORD_HASH_INVALID",
      "El hash generado no es bcrypt de 60 caracteres.",
      { operation: "password-hash" },
    );
  }
}

/**
 * bcrypt compatibility adapter. The legacy PasswordHash column is varchar(255)
 * and the verified samples are 60-character bcrypt strings.
 */
export function createBcryptPasswordHasher(
  bcrypt: BcryptLike,
  rounds = 12,
): PasswordHasher {
  if (
    typeof bcrypt !== "object" ||
    bcrypt === null ||
    typeof bcrypt.hash !== "function"
  ) {
    throw new PersistenceError(
      "CONFIG_INVALID",
      "El módulo bcrypt no expone hash().",
      { operation: "password-hash" },
    );
  }
  if (!Number.isInteger(rounds) || rounds < 10 || rounds > 14) {
    throw new PersistenceError(
      "CONFIG_INVALID",
      "El coste bcrypt debe ser un entero entre 10 y 14.",
      { operation: "password-hash" },
    );
  }

  return {
    async hash(password: string): Promise<string> {
      if (typeof password !== "string" || password.length === 0) {
        throw new PersistenceError(
          "CONFIG_INVALID",
          "La contraseña no puede estar vacía.",
          { operation: "password-hash" },
        );
      }
      const hash = await bcrypt.hash(password, rounds);
      assertBcryptHash(hash);
      return hash;
    },

    async verify(password: string, passwordHash: string): Promise<boolean> {
      if (typeof bcrypt.compare !== "function") {
        throw new PersistenceError(
          "CONFIG_INVALID",
          "El módulo bcrypt no expone compare(); no se puede verificar la contraseña.",
          { operation: "password-hash" },
        );
      }
      if (!isBcryptHash(passwordHash)) {
        return false;
      }
      return bcrypt.compare(password, passwordHash);
    },
  };
}
