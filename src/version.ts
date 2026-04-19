import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function readPackageVersion(): string {
  const path = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}
