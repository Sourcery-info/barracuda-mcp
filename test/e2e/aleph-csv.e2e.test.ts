import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AlephClient } from "../../src/aleph/client.js";
import { loadConfig } from "../../src/config.js";
import { DuckDbManager } from "../../src/duckdb/manager.js";
import { runAlephLoadCsvTool } from "../../src/mcp/alephLoadCsv.js";
import { runDuckDbListTablesTool } from "../../src/mcp/duckdbListTables.js";
import { runDuckDbQueryTool } from "../../src/mcp/duckdbQuery.js";
import { createLoggingFetch } from "./loggingFetch.js";

function isoFilenameTimestamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

const entityId = process.env.ALEPH_E2E_CSV_ENTITY_ID?.trim() || undefined;

/**
 * Targeted CSV/tabular-entity e2e. Set `ALEPH_E2E_CSV_ENTITY_ID=<id>` to
 * enable (skipped cleanly when unset). Loads a real Table/CSV/Workbook entity
 * via aleph_load_csv and then runs COUNT + sample queries with duckdb_query.
 */
describe.skipIf(!entityId)(
  "Aleph CSV → DuckDB (e2e, targeted)",
  () => {
    it(
      `loads entity ${entityId ?? "<unset>"} into DuckDB and queries it`,
      async () => {
        if (!entityId) throw new Error("unreachable: entityId is required");

        const config = loadConfig(process.env, "e2e");
        const logsDir = join(process.cwd(), "logs");
        await mkdir(logsDir, { recursive: true });
        const logPath = join(
          logsDir,
          `aleph-e2e-csv-${isoFilenameTimestamp()}.log`
        );

        await appendFile(
          logPath,
          [
            `Aleph e2e csv/duckdb — ${config.alephOrigin}`,
            `Started ${new Date().toISOString()}`,
            `entity id: ${entityId}`,
            `csvMaxBytes: ${config.csvMaxBytes}`,
            `duckdbMemoryLimit: ${config.duckdbMemoryLimit ?? "(default)"}`,
            "",
          ].join("\n"),
          "utf8"
        );

        const client = new AlephClient(config, createLoggingFetch(logPath));
        const manager = new DuckDbManager({
          memoryLimit: config.duckdbMemoryLimit,
        });

        try {
          await appendFile(logPath, `\n--- e2e: runAlephLoadCsvTool ---\n`, "utf8");
          const loadResult = await runAlephLoadCsvTool(
            client,
            manager,
            config,
            { id: entityId }
          );
          expect(loadResult.isError).toBeFalsy();
          expect(loadResult.content?.[0]?.type).toBe("text");
          const loadText = (loadResult.content?.[0] as { text: string }).text;
          await appendFile(logPath, `${loadText}\n`, "utf8");
          const loaded = JSON.parse(loadText) as {
            table: string;
            rowCount: number;
            source: string;
            columns: { name: string; type: string }[];
          };
          console.log(
            `[e2e] aleph_load_csv (${entityId}): table=${loaded.table} ` +
              `source=${loaded.source} rowCount=${loaded.rowCount}`
          );
          expect(loaded.rowCount).toBeGreaterThan(0);

          await appendFile(logPath, `\n--- e2e: runDuckDbQueryTool COUNT ---\n`, "utf8");
          const countResult = await runDuckDbQueryTool(manager, {
            sql: `SELECT count(*) AS n FROM "${loaded.table}"`,
          });
          expect(countResult.isError).toBeFalsy();
          const countText = (countResult.content?.[0] as { text: string })
            .text;
          await appendFile(logPath, `${countText}\n`, "utf8");
          const counted = JSON.parse(countText) as {
            rows: { n: string }[];
          };
          expect(Number(counted.rows[0]!.n)).toBe(loaded.rowCount);

          await appendFile(
            logPath,
            `\n--- e2e: runDuckDbQueryTool sample (5 rows, first columns) ---\n`,
            "utf8"
          );
          const firstColumns = loaded.columns
            .slice(0, 5)
            .map((c) => `"${c.name.replaceAll('"', '""')}"`)
            .join(", ");
          const sampleResult = await runDuckDbQueryTool(manager, {
            sql: `SELECT ${firstColumns || "*"} FROM "${loaded.table}" LIMIT 5`,
          });
          expect(sampleResult.isError).toBeFalsy();
          await appendFile(
            logPath,
            `${(sampleResult.content?.[0] as { text: string }).text}\n`,
            "utf8"
          );

          const listResult = await runDuckDbListTablesTool(manager, {});
          expect(listResult.isError).toBeFalsy();
          await appendFile(
            logPath,
            `\n--- e2e: runDuckDbListTablesTool ---\n${(listResult.content?.[0] as { text: string }).text}\n`,
            "utf8"
          );

          console.log(`[e2e] Log file: ${logPath}`);
        } finally {
          await manager.close();
        }
      }
    );
  }
);
