import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { DuckDbManager } from "../duckdb/manager.js";

export const duckdbListTablesInputSchema = z.object({});

export async function runDuckDbListTablesTool(
  manager: DuckDbManager,
  rawArgs: unknown
): Promise<CallToolResult> {
  const parsed = duckdbListTablesInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Invalid arguments: ${parsed.error.message}`,
        },
      ],
    };
  }

  try {
    const tables = manager.listTables().map((entry) => ({
      table: entry.tableName,
      entityId: entry.entityId,
      schema: entry.entitySchema,
      fileName: entry.fileName,
      dataset: entry.dataset,
      rowCount: entry.rowCount,
      columns: entry.columns,
      source: entry.source,
      loadedAt: entry.loadedAt,
    }));
    const payload =
      tables.length > 0
        ? { tables }
        : {
            tables: [],
            message:
              "No tables are loaded in DuckDB yet. Load a tabular OpenAleph entity first with aleph_load_csv, then query it here with SQL.",
          };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unexpected error: ${message}`,
        },
      ],
    };
  }
}
