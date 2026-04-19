import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AlephClient } from "../../src/aleph/client.js";
import { loadConfig } from "../../src/config.js";
import { runAlephGetEntityMarkdownTool } from "../../src/mcp/alephGetEntityMarkdown.js";
import {
  e2eSearchQueryFromEnv,
  entityIdsFromSearchResults,
  parseE2eFetchTopN,
} from "./e2eSearchEnv.js";
import { createLoggingFetch } from "./loggingFetch.js";

function isoFilenameTimestamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

describe("Aleph search against configured instance (e2e)", () => {
  it("performs a search and logs request/response", async () => {
    const config = loadConfig(process.env, "e2e");
    const logsDir = join(process.cwd(), "logs");
    await mkdir(logsDir, { recursive: true });
    const logPath = join(logsDir, `aleph-e2e-search-${isoFilenameTimestamp()}.log`);

    const searchInput = e2eSearchQueryFromEnv(process.env);
    const paramsLine = `e2e search params: ${JSON.stringify(searchInput)}\n`;

    await appendFile(
      logPath,
      `Aleph e2e search — ${config.alephOrigin}\nStarted ${new Date().toISOString()}\n${paramsLine}\n`,
      "utf8"
    );

    const client = new AlephClient(config, createLoggingFetch(logPath));

    const data = await client.search(searchInput);

    expect(data).toBeTypeOf("object");
    expect(data).not.toBeNull();
    const rec = data as Record<string, unknown>;
    expect(typeof rec.total).toBe("number");
    expect(Array.isArray(rec.results)).toBe(true);

    const fetchTopN = parseE2eFetchTopN(process.env);
    const entityIds = entityIdsFromSearchResults(data, fetchTopN);

    await appendFile(
      logPath,
      `\n--- e2e: GET /api/2/entities/:id for top ${fetchTopN} hit(s) (${entityIds.length} id(s) found) ---\n`,
      "utf8"
    );

    for (const id of entityIds) {
      const entity = await client.getEntity(id);
      expect(entity).toBeTypeOf("object");
      expect(entity).not.toBeNull();
    }

    const firstId = entityIds[0];
    if (firstId) {
      await appendFile(
        logPath,
        `\n--- e2e: aleph_get_entity_markdown for first id ---\n`,
        "utf8"
      );
      const mdResult = await runAlephGetEntityMarkdownTool(client, { id: firstId });
      if (mdResult.content?.[0]?.type === "text") {
        await appendFile(logPath, `${mdResult.content[0].text}\n`, "utf8");
      }
      if (mdResult.isError) {
        console.log(
          `[e2e] aleph_get_entity_markdown (${firstId}): skipped or error —`,
          mdResult.content?.[0]?.type === "text" ? mdResult.content[0].text.slice(0, 200) : ""
        );
      } else if (mdResult.content?.[0]?.type === "text") {
        const parsed = JSON.parse(mdResult.content[0].text) as Record<string, unknown>;
        const mdChars = parsed.bodyMarkdownFullChars;
        const txtChars = parsed.bodyTextFullChars;
        console.log(
          `[e2e] aleph_get_entity_markdown (${firstId}): schema=${String(parsed.schema)} bodyMarkdownFullChars=${String(mdChars)} bodyTextFullChars=${String(txtChars)} htmlSourceTruncated=${String(parsed.htmlSourceTruncated)}`
        );
        if (typeof parsed.bodyMarkdown === "string") {
          expect(parsed.bodyMarkdownFullChars).toBe(String(parsed.bodyMarkdown).length);
        } else if (typeof parsed.bodyText === "string") {
          expect(parsed.bodyTextFullChars).toBe(String(parsed.bodyText).length);
        } else {
          throw new Error(
            "e2e: expected bodyMarkdown (Email) or bodyText (Page/Pages) in aleph_get_entity_markdown payload"
          );
        }
      }
    }

    console.log(`[e2e] Log file: ${logPath}`);
    console.log(`[e2e] Search: ${paramsLine.trimEnd()}`);
    console.log(
      `[e2e] Fetched ${entityIds.length} entity/entities:`,
      entityIds.length ? entityIds.join(", ") : "(none — widen ALEPH_E2E_SEARCH_* or check data)"
    );
  });
});
