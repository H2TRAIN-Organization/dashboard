import "server-only";
import { getServerRuntime } from "./runtime";
import { readAllAdminKubios } from "./kubios-admin-runtime";
import { encryptLogicalCopy } from "@/server/infrastructure/crypto/logical-backup";
import { createAdminDatabaseDownloadHandlers } from "@/server/http/handlers/admin-database-downloads";

export async function getAdminDatabaseDownloads() {
  const application = await getServerRuntime();
  return createAdminDatabaseDownloadHandlers({ auth: application.useCases.auth, database: application.useCases.adminDatabase, readKubios: readAllAdminKubios, encrypt: encryptLogicalCopy });
}
