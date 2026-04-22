import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AlephClient } from "../../src/aleph/client.js";
import { loadConfig } from "../../src/config.js";
import { runAlephGetEntityTool } from "../../src/mcp/alephGetEntity.js";
import { runAlephGetEntityMarkdownTool } from "../../src/mcp/alephGetEntityMarkdown.js";
import {
  e2eEntityFetchMarkdownFromEnv,
  e2eEntityIdFromEnv,
  e2eEntityShapingFromEnv,
} from "./e2eEntityEnv.js";
import { createLoggingFetch } from "./loggingFetch.js";

function isoFilenameTimestamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

const entityId = e2eEntityIdFromEnv(process.env);

/**
 * Targeted single-entity e2e. Set `ALEPH_E2E_ENTITY_ID=<id>` to enable (the
 * test is skipped when no id is present). Exercises `aleph_get_entity` with
 * shaping env vars and optionally `aleph_get_entity_markdown` for full body
 * text — useful for reproducing issues with one specific document.
 */
describe.skipIf(!entityId)(
  "Aleph get entity by id (e2e, targeted)",
  () => {
    it(
      `fetches entity ${entityId ?? "<unset>"} and logs structured output`,
      async () => {
        if (!entityId) throw new Error("unreachable: entityId is required");

        const config = loadConfig(process.env, "e2e");
        const logsDir = join(process.cwd(), "logs");
        await mkdir(logsDir, { recursive: true });
        const logPath = join(
          logsDir,
          `aleph-e2e-entity-${isoFilenameTimestamp()}.log`
        );

        const shapingArgs = e2eEntityShapingFromEnv(process.env);
        const fetchMarkdown = e2eEntityFetchMarkdownFromEnv(process.env);

        await appendFile(
          logPath,
          [
            `Aleph e2e get-entity — ${config.alephOrigin}`,
            `Started ${new Date().toISOString()}`,
            `entity id: ${entityId}`,
            `shaping: ${JSON.stringify(shapingArgs)}`,
            `fetchMarkdown: ${String(fetchMarkdown)}`,
            "",
          ].join("\n"),
          "utf8"
        );

        const client = new AlephClient(config, createLoggingFetch(logPath));

        await appendFile(
          logPath,
          `\n--- e2e: runAlephGetEntityTool ---\n`,
          "utf8"
        );
        const entityResult = await runAlephGetEntityTool(client, {
          id: entityId,
          ...shapingArgs,
        });
        expect(entityResult.isError).toBeFalsy();
        if (entityResult.content?.[0]?.type === "text") {
          await appendFile(
            logPath,
            `${entityResult.content[0].text}\n`,
            "utf8"
          );
          const parsed = JSON.parse(entityResult.content[0].text) as
            | Record<string, unknown>
            | unknown[];
          const single = Array.isArray(parsed)
            ? (parsed[0] as Record<string, unknown> | undefined)
            : parsed;
          if (single && typeof single === "object") {
            console.log(
              `[e2e] aleph_get_entity (${entityId}): schema=${String(
                single.schema
              )} truncatedBody=${String(single.truncatedBody)}`
            );
          }
        }

        if (fetchMarkdown) {
          await appendFile(
            logPath,
            `\n--- e2e: runAlephGetEntityMarkdownTool ---\n`,
            "utf8"
          );
          const mdResult = await runAlephGetEntityMarkdownTool(client, {
            id: entityId,
          });
          if (mdResult.content?.[0]?.type === "text") {
            await appendFile(logPath, `${mdResult.content[0].text}\n`, "utf8");
          }
          if (mdResult.isError) {
            console.log(
              `[e2e] aleph_get_entity_markdown (${entityId}): skipped or error —`,
              mdResult.content?.[0]?.type === "text"
                ? mdResult.content[0].text.slice(0, 200)
                : ""
            );
          } else if (mdResult.content?.[0]?.type === "text") {
            const parsed = JSON.parse(mdResult.content[0].text) as Record<
              string,
              unknown
            >;
            console.log(
              `[e2e] aleph_get_entity_markdown (${entityId}): schema=${String(
                parsed.schema
              )} bodyMarkdownFullChars=${String(
                parsed.bodyMarkdownFullChars
              )} bodyTextFullChars=${String(
                parsed.bodyTextFullChars
              )} htmlSourceTruncated=${String(parsed.htmlSourceTruncated)}`
            );
          }
        }

        console.log(`[e2e] Log file: ${logPath}`);
      }
    );
  }
);
