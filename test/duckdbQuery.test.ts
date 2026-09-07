import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbManager } from "../src/duckdb/manager.js";
import { runDuckDbQueryTool } from "../src/mcp/duckdbQuery.js";
import { fileURLToPath } from "node:url";

const paymentsCsv = fileURLToPath(
  new URL("./fixtures/payments.csv", import.meta.url)
);

describe("runDuckDbQueryTool", () => {
  let manager: DuckDbManager;

  beforeEach(async () => {
    manager = new DuckDbManager();
    await manager.loadFileToTable(paymentsCsv, "payments", "csv");
  });

  afterEach(async () => {
    await manager.close();
  });

  async function parseResult(result: {
    isError?: boolean;
    content?: { type: string; text: string }[];
  }): Promise<unknown> {
    const text = result.content?.[0]?.text ?? "";
    return JSON.parse(text);
  }

  it("runs a SELECT and returns columns/rows/rowCount", async () => {
    const result = await runDuckDbQueryTool(manager, {
      sql: "SELECT name, amount FROM payments ORDER BY amount DESC LIMIT 2",
    });
    expect(result.isError).toBeFalsy();
    const parsed = (await parseResult(result)) as {
      columns: { name: string }[];
      rows: Record<string, unknown>[];
      rowCount: number;
      rowLimitHit: boolean;
    };
    expect(parsed.columns.map((c) => c.name)).toEqual(["name", "amount"]);
    expect(parsed.rowCount).toBe(2);
    expect(parsed.rows[0]!.name).toBe("baz");
    expect(parsed.rowLimitHit).toBe(false);
  });

  it("reports rowLimitHit when the cap truncates results", async () => {
    const result = await runDuckDbQueryTool(manager, {
      sql: "SELECT * FROM payments",
      maxRows: 2,
    });
    const parsed = (await parseResult(result)) as { rowLimitHit: boolean };
    expect(parsed.rowLimitHit).toBe(true);
  });

  it("isError for blocked write statements", async () => {
    const result = await runDuckDbQueryTool(manager, {
      sql: "INSERT INTO payments VALUES ('x', 1, 'x')",
    });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Rejected");
  });

  it("isError for multi-statement SQL", async () => {
    const result = await runDuckDbQueryTool(manager, {
      sql: "SELECT 1; SELECT 2",
    });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("statements found");
  });

  it("isError for syntax errors", async () => {
    const result = await runDuckDbQueryTool(manager, { sql: "SELEC 1" });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Invalid SQL");
  });

  it("isError for missing sql argument", async () => {
    const result = await runDuckDbQueryTool(manager, {});
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Invalid arguments");
  });

  it("isError when querying a missing table (DuckDB message verbatim)", async () => {
    const result = await runDuckDbQueryTool(manager, {
      sql: "SELECT * FROM nope",
    });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Invalid SQL");
    expect(result.content?.[0]?.text).toContain("Catalog Error");
  });
});
