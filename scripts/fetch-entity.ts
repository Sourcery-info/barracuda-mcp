#!/usr/bin/env tsx
/**
 * Quickly fetch a single OpenAleph entity for ad-hoc inspection.
 *
 * Usage:
 *   npm run e2e:entity -- <entity-id> [--raw] [--markdown] [--no-markdown]
 *   ALEPH_E2E_ENTITY_ID=<id> npm run e2e:entity
 *
 * Respects the same `.env` as the e2e tests (ALEPH_BASE_URL / ALEPH_API_KEY,
 * OPAL_HOST / OPAL_API_KEY) plus `ALEPH_E2E_ENTITY_*` shaping knobs. The id
 * on the CLI wins over `ALEPH_E2E_ENTITY_ID`. Prints the structured
 * `aleph_get_entity` output to stdout and, unless `--no-markdown` is set,
 * follows up with `aleph_get_entity_markdown` for the full body text.
 */
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { AlephClient } from "../src/aleph/client.js";
import { loadConfig } from "../src/config.js";
import { runAlephGetEntityTool } from "../src/mcp/alephGetEntity.js";
import { runAlephGetEntityMarkdownTool } from "../src/mcp/alephGetEntityMarkdown.js";
import {
  e2eEntityFetchMarkdownFromEnv,
  e2eEntityIdFromEnv,
  e2eEntityShapingFromEnv,
} from "../test/e2e/e2eEntityEnv.js";

type CliArgs = {
  id?: string;
  forceRaw: boolean;
  forceMarkdown: boolean | undefined;
  help: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    forceRaw: false,
    forceMarkdown: undefined,
    help: false,
  };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      out.help = true;
    } else if (raw === "--raw") {
      out.forceRaw = true;
    } else if (raw === "--markdown") {
      out.forceMarkdown = true;
    } else if (raw === "--no-markdown") {
      out.forceMarkdown = false;
    } else if (!raw.startsWith("-") && out.id === undefined) {
      out.id = raw;
    } else {
      process.stderr.write(`Unknown argument: ${raw}\n`);
      process.exit(2);
    }
  }
  return out;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run e2e:entity -- <entity-id> [--raw] [--markdown] [--no-markdown]",
    "  ALEPH_E2E_ENTITY_ID=<id> npm run e2e:entity",
    "",
    "Options:",
    "  --raw           Print raw Aleph JSON (responseMode=raw).",
    "  --markdown      Also fetch full bodyText/bodyMarkdown (default when supported).",
    "  --no-markdown   Skip the follow-up markdown call.",
    "  -h, --help      Show this help.",
    "",
    "Environment (same prefixes as the e2e test suite):",
    "  ALEPH_BASE_URL / ALEPH_API_KEY (or OPAL_HOST / OPAL_API_KEY)",
    "  ALEPH_E2E_ENTITY_ID",
    "  ALEPH_E2E_ENTITY_INCLUDE_CONTENT_FIELDS",
    "  ALEPH_E2E_ENTITY_CONTENT_PREVIEW_CHARS",
    "  ALEPH_E2E_ENTITY_BODY_MARKDOWN_MAX_CHARS",
    "  ALEPH_E2E_ENTITY_MAX_ARRAY_VALUES_PER_FIELD",
    "  ALEPH_E2E_ENTITY_RESPONSE_MODE (structured|raw)",
    "  ALEPH_E2E_ENTITY_INCLUDE_RAW",
    "  ALEPH_E2E_ENTITY_FETCH_MARKDOWN (default true)",
  ].join("\n");
}

async function main(): Promise<void> {
  loadDotenv({ path: resolve(process.cwd(), ".env") });

  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const envId = e2eEntityIdFromEnv(process.env);
  const id = cli.id ?? envId;
  if (!id) {
    process.stderr.write(
      `Missing entity id.\n\n${usage()}\n`
    );
    process.exit(2);
  }

  const config = loadConfig(process.env, "e2e-cli");
  const client = new AlephClient(config);

  const shapingArgs = e2eEntityShapingFromEnv(process.env);
  if (cli.forceRaw) shapingArgs.responseMode = "raw";

  process.stderr.write(
    `[entity-cli] ${config.alephOrigin} id=${id} shaping=${JSON.stringify(shapingArgs)}\n`
  );

  const entityResult = await runAlephGetEntityTool(client, {
    id,
    ...shapingArgs,
  });
  const entityText =
    entityResult.content?.[0]?.type === "text"
      ? entityResult.content[0].text
      : "<no text content>";
  process.stdout.write(`# aleph_get_entity\n${entityText}\n`);
  if (entityResult.isError) process.exitCode = 1;

  const fetchMarkdown =
    cli.forceMarkdown ?? e2eEntityFetchMarkdownFromEnv(process.env);
  if (fetchMarkdown) {
    const mdResult = await runAlephGetEntityMarkdownTool(client, { id });
    const mdText =
      mdResult.content?.[0]?.type === "text"
        ? mdResult.content[0].text
        : "<no text content>";
    process.stdout.write(`\n# aleph_get_entity_markdown\n${mdText}\n`);
    if (mdResult.isError && process.exitCode === undefined) {
      process.exitCode = 1;
    }
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`fetch-entity failed: ${message}\n`);
  process.exit(1);
});
