const env = process.env;
const runId =
  env.ACCEPTANCE_RUN_ID ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Synthetic fixtures only. Passwords are disposable acceptance credentials,
 * never production values. The backend under test must be seeded with the
 * admin account; the other accounts are created through the admin API.
 */
export const admin = {
  email: env.ACCEPTANCE_ADMIN_EMAIL ?? "admin.acceptance@example.test",
  password: env.ACCEPTANCE_ADMIN_PASSWORD ?? "Acceptance-Admin-1!",
};

export const doctor = {
  username: env.ACCEPTANCE_DOCTOR_USERNAME ?? `acceptance.doctor.${runId}`,
  password: env.ACCEPTANCE_DOCTOR_PASSWORD ?? "Acceptance-Doctor-1!",
};

export const user = {
  username: env.ACCEPTANCE_USER_USERNAME ?? `acceptance.user.${runId}`,
  password: env.ACCEPTANCE_USER_PASSWORD ?? "Acceptance-User-1!",
};

/** Seeded user that already has at least one health-data row. */
export const userWithData = {
  username: env.ACCEPTANCE_HAS_DATA_USERNAME ?? "acceptance.hasdata",
};

/** Seeded bcrypt user with rows on adjacent calendar days for day filtering. */
export const bcryptUser = {
  username: env.ACCEPTANCE_BCRYPT_USERNAME ?? "acceptance.bcrypt",
  password: env.ACCEPTANCE_BCRYPT_PASSWORD ?? "Acceptance-Bcrypt-1!",
};

export { runId };
