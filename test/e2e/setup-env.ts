import { config } from "dotenv";
import { resolve } from "node:path";

/**
 * Load repo-root `.env` so `ALEPH_*` / `OPAL_*` match your local OpenAleph instance.
 * (The MCP server itself does not load `.env`; e2e tests do.)
 */
config({ path: resolve(process.cwd(), ".env") });
