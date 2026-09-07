import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbManager } from "../src/duckdb/manager.js";
import { runDuckDbListTablesTool } from "../src/mcp/duckdbListTables.js";

describe("runDuckDbListTablesTool", () => {
  let manager: DuckDbManager;

  beforeEach(() => {
    manager = new DuckDbManager();
  });

  afterEach(async () => {
    await manager.close();
  });

  it("returns guidance when no tables are loaded", async () => {
    const result = await runDuckDbListTablesTool(manager, {});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content?.[0]?.text ?? "") as {
      tables: unknown[];
      message: string;
    };
    expect(parsed.tables).toEqual([]);
    expect(parsed.message).toContain("aleph_load_csv");
  });

  it("lists registered tables with metadata", async () => {
    manager.registerTable({
      tableName: "payments",
      entityId: "tbl.111",
      entitySchema: "Table",
      fileName: "payments.csv",
      dataset: "coll-1",
      rowCount: 3,
      columns: [
        { name: "name", type: "VARCHAR" },
        { name: "amount", type: "BIGINT" },
      ],
      source: "file",
      loadedAt: "2026-01-01T00:00:00.000Z",
    });
    manager.registerTable({
      tableName: "mapped",
      entityId: "tbl.222",
      entitySchema: "Table",
      fileName: null,
      dataset: "coll-1",
      rowCount: 42,
      columns: [{ name: "name", type: "VARCHAR" }],
      source: "rows",
      loadedAt: "2026-01-02T00:00:00.000Z",
    });

    const result = await runDuckDbListTablesTool(manager, {});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content?.[0]?.text ?? "") as {
      tables: {
        table: string;
        entityId: string;
        source: string;
        rowCount: number;
        columns: { name: string }[];
      }[];
      message?: string;
    };
    expect(parsed.tables).toHaveLength(2);
    expect(parsed.message).toBeUndefined();
    const names = parsed.tables.map((t) => t.table);
    expect(names).toEqual(["mapped", "payments"]);
    const payments = parsed.tables.find((t) => t.table === "payments")!;
    expect(payments.entityId).toBe("tbl.111");
    expect(payments.rowCount).toBe(3);
    expect(payments.columns).toEqual([
      { name: "name", type: "VARCHAR" },
      { name: "amount", type: "BIGINT" },
    ]);
  });
});
