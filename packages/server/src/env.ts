import { fileURLToPath } from "node:url";

// Loads .env from the repository root into process.env. Real environment variables win; a missing file is fine.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
