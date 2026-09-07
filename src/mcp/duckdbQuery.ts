import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DuckDbQueryError, type DuckDbManager } from "../duckdb/manager.js";

export const duckdbQueryInputSchema = z.object({
  sql: z
    .string()
    .trim()
    .min(1)
    .describe(
      "One read-only SQL statement to run against the loaded tables (SELECT, EXPLAIN, SHOW, DESCRIBE, or PRAGMA). INSERT/UPDATE/CREATE/COPY/ATTACH and multi-statement input are rejected. Use aleph_list_tables to see available tables."
    ),
  maxRows: z
    .number()
    .int()
    .min(1)
    .max(5_000)
    .optional()
    .default(200)
    .describe("Max rows to return (1–5000, default 200)."),
});

export type DuckDbQueryArgs = z.infer<typeof duckdbQueryInputSchema>;

export async function runDuckDbQueryTool(
  manager: DuckDbManager,
  rawArgs: unknown
): Promise<CallToolResult> {
  const parsed = duckdbQueryInputSchema.safeParse(rawArgs);
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
  const args = parsed.data;

  try {
    const result = await manager.runQuery(args.sql, args.maxRows);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (e) {
    if (e instanceof DuckDbQueryError) {
      return {
        isError: true,
        content: [{ type: "text", text: e.message }],
      };
    }
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
