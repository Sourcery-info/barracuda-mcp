import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { unlink } from "node:fs/promises";
import { z } from "zod";
import type { AlephClient } from "../aleph/client.js";
import { AlephHttpError } from "../aleph/client.js";
import { CsvSourceClient, CsvSourceError } from "../aleph/csvSource.js";
import type { AppConfig } from "../config.js";
import { quoteIdentifier, type DuckDbManager } from "../duckdb/manager.js";

/** Sanitize a user-supplied table alias to a safe SQL identifier fragment. */
export function sanitizeTableName(raw: string): string {
  return raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/g, "_")
    .replaceAll(/_{2,}/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 63);
}

export function resolveTableName(
  alias: string | undefined,
  entityId: string
): string {
  if (alias) {
    const sanitized = sanitizeTableName(alias);
    if (sanitized) return sanitized;
  }
  return `t_${sanitizeTableName(entityId) || "unknown"}`;
}

export const alephLoadCsvInputSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .describe(
      "OpenAleph entity id of a tabular entity (schema Table, CSV, or Workbook, or one exposing links.csv/links.file). Use aleph_search to find one."
    ),
  alias: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Optional SQL table name for the loaded data (sanitized to [a-z0-9_]{1,63}). Default: t_<sanitized entity id>."
    ),
  sampleRows: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .default(10)
    .describe(
      "How many sample rows to include in the response (0 disables the sample). Default 10."
    ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Re-download and replace the table even when this entity is already loaded under the same name. Default false."
    ),
});

export type AlephLoadCsvArgs = z.infer<typeof alephLoadCsvInputSchema>;

function formatAlephError(err: AlephHttpError): string {
  const body =
    err.body !== null && err.body !== undefined
      ? JSON.stringify(err.body)
      : "";
  return body ? `HTTP ${err.status}: ${err.message}\n${body}`
    : `HTTP ${err.status}: ${err.message}`;
}

export async function runAlephLoadCsvTool(
  client: Pick<AlephClient, "getEntity" | "search" | "fetchArchive">,
  manager: DuckDbManager,
  config: Pick<AppConfig, "alephOrigin" | "csvMaxBytes">,
  rawArgs: unknown
): Promise<CallToolResult> {
  const parsed = alephLoadCsvInputSchema.safeParse(rawArgs);
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
  const csvSource = new CsvSourceClient(client, {
    alephOrigin: config.alephOrigin,
    csvMaxBytes: config.csvMaxBytes,
  });

  const requestedId = args.id.trim();

  function reusedPayload(entry: {
    tableName: string;
    entityId: string;
    source: "file" | "rows";
    rowCount: number;
    columns: { name: string; type: string }[];
    entitySchema: string | null;
    dataset: string | null;
    fileName: string | null;
  }): CallToolResult {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              table: entry.tableName,
              source: entry.source,
              rowCount: entry.rowCount,
              columns: entry.columns,
              sample: [],
              entity: {
                id: entry.entityId,
                schema: entry.entitySchema,
                dataset: entry.dataset,
                fileName: entry.fileName,
              },
              reused: true,
              note: `Table "${entry.tableName}" is already loaded with this entity; pass force=true to reload it.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  try {
    // Fast reuse path: no HTTP call when the exact requested id is already
    // loaded under the resolved table name.
    const quickName = resolveTableName(args.alias, requestedId);
    const quickExisting = manager.getTable(quickName);
    if (quickExisting && quickExisting.entityId === requestedId && !args.force) {
      return reusedPayload(quickExisting);
    }

    const tabular = await csvSource.fetchTabularEntity(args.id);
    const tableName = resolveTableName(args.alias, tabular.id);

    const existing = manager.getTable(tableName);
    if (existing && existing.entityId === tabular.id && !args.force) {
      return reusedPayload(existing);
    }

    const link = csvSource.archiveLinkUrl(tabular.entity);
    const source: "file" | "rows" = link ? "file" : "rows";
    let tmpPath: string | undefined;
    let bytesDownloaded: number | undefined;
    let loaded: { rowCount: number; columns: { name: string; type: string }[] };

    try {
      if (link) {
        const download = await csvSource.downloadArchiveFile(tabular.entity);
        tmpPath = download.tmpPath;
        bytesDownloaded = download.bytes;
        loaded = await manager.loadFileToTable(tmpPath, tableName, "csv");
      } else {
        const rows = await csvSource.reconstructRows(tabular.entity);
        tmpPath = rows.tmpPath;
        loaded = await manager.loadFileToTable(tmpPath, tableName, "json");
      }
    } finally {
      if (tmpPath !== undefined) {
        await unlink(tmpPath).catch(() => {});
      }
    }

    manager.registerTable({
      tableName,
      entityId: tabular.id,
      entitySchema: tabular.entity.schema ?? null,
      fileName: tabular.fileName,
      dataset: tabular.dataset,
      rowCount: loaded.rowCount,
      columns: loaded.columns,
      source,
      loadedAt: new Date().toISOString(),
    });

    let sample: Record<string, unknown>[] = [];
    if (args.sampleRows > 0) {
      const sampleResult = await manager.runQuery(
        `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${args.sampleRows}`
      );
      sample = sampleResult.rows;
    }

    const payload: Record<string, unknown> = {
      table: tableName,
      source,
      rowCount: loaded.rowCount,
      columns: loaded.columns,
      sample,
      entity: {
        id: tabular.id,
        schema: tabular.entity.schema ?? null,
        dataset: tabular.dataset,
        fileName: tabular.fileName,
      },
      reused: false,
    };
    if (bytesDownloaded !== undefined) {
      payload.bytesDownloaded = bytesDownloaded;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  } catch (e) {
    if (e instanceof AlephHttpError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatAlephError(e),
          },
        ],
      };
    }
    if (e instanceof CsvSourceError) {
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
