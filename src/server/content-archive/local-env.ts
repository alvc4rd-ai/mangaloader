import "server-only";

import { config as loadEnv } from "dotenv";

let loaded = false;

export function loadContentArchiveLocalEnv() {
  if (loaded) return;
  for (const path of [".env.local", ".backup.env", ".env"]) {
    loadEnv({ path, override: false, quiet: true });
  }
  loaded = true;
}
