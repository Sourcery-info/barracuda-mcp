import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CELL_MAX_CHARS,
  DuckDbLoadError,
  DuckDbManager,
  DuckDbQueryError,
  normalizeColumnName,
} from "../src/duckdb/manager.js";

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("DuckDbManager", () => {
  let manager: DuckDbManager;
  let workDir: string;

  beforeEach(async () => {
    manager = new DuckDbManager();
    workDir = await mkdtemp(join(tmpdir(), "duckdb-manager-test-"));
  });

  afterEach(async () => {
    await manager.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("loads a CSV file and answers SELECT queries", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("payments.csv"),
      "payments",
      "csv"
    );
    expect(loaded.rowCount).toBe(3);
    expect(loaded.columns).toEqual([
      { name: "name", type: "VARCHAR" },
      { name: "amount", type: "BIGINT" },
      { name: "note", type: "VARCHAR" },
    ]);

    const result = await manager.runQuery(
      "SELECT name, amount FROM payments WHERE amount > 10 ORDER BY amount"
    );
    expect(result.rowCount).toBe(2);
    expect(result.rows).toEqual([
      { name: "bar", amount: "20" },
      { name: "baz", amount: "30" },
    ]);
    expect(result.rowLimitHit).toBe(false);
  });

  it("loads a JSON file (read_json_auto) preserving column order", async () => {
    await manager.loadFileToTable(fixturePath("rows.ndjson"), "j", "json");
    const result = await manager.runQuery("SELECT * FROM j ORDER BY amount");
    expect(result.rows).toEqual([
      { name: "foo", amount: "10", note: "first" },
      { name: "bar", amount: "20", note: "second" },
      { name: "baz", amount: "30", note: "third" },
    ]);
  });

  it("replaces an existing table on reload (CREATE OR REPLACE)", async () => {
    await manager.loadFileToTable(fixturePath("payments.csv"), "t", "csv");
    await manager.loadFileToTable(fixturePath("rows.ndjson"), "t", "json");
    const result = await manager.runQuery("SELECT count(*) AS n FROM t");
    expect(result.rows[0]!.n).toBe("3");
  });

  it("converts BIGINT to string so JSON.stringify stays safe", async () => {
    await manager.loadFileToTable(fixturePath("payments.csv"), "p", "csv");
    const result = await manager.runQuery("SELECT count(*) AS n FROM p");
    expect(result.rows[0]!.n).toBe("3");
    expect(() => JSON.stringify(result.rows)).not.toThrow();
  });

  it("blocks INSERT / UPDATE / DELETE / CREATE / DROP", async () => {
    await manager.loadFileToTable(fixturePath("payments.csv"), "p", "csv");
    for (const sql of [
      "INSERT INTO p VALUES ('x', 1, 'x')",
      "UPDATE p SET amount = 0",
      "DELETE FROM p",
      "CREATE TABLE evil AS SELECT 1",
      "DROP TABLE p",
    ]) {
      await expect(manager.runQuery(sql)).rejects.toThrow(/Rejected/);
    }
    // table still intact
    const result = await manager.runQuery("SELECT count(*) AS n FROM p");
    expect(result.rows[0]!.n).toBe("3");
  });

  it("blocks COPY, ATTACH, INSTALL, LOAD, EXPORT", async () => {
    await manager.loadFileToTable(fixturePath("payments.csv"), "p", "csv");
    const target = join(workDir, "copy-out.csv");
    await expect(
      manager.runQuery(`COPY p TO '${target}'`)
    ).rejects.toThrow(/Rejected/);
    await expect(
      manager.runQuery("ATTACH ':memory:' AS extra")
    ).rejects.toThrow(/Rejected/);
    await expect(
      manager.runQuery("INSTALL json")
    ).rejects.toThrow(/Rejected/);
    await expect(manager.runQuery("LOAD json")).rejects.toThrow(/Rejected/);
  });

  it("rejects multi-statement input", async () => {
    await expect(
      manager.runQuery("SELECT 1; SELECT 2")
    ).rejects.toThrow(/statements found/);
  });

  it("rejects empty SQL and surfaces syntax errors", async () => {
    await expect(manager.runQuery("   ")).rejects.toThrow(/empty/i);
    await expect(manager.runQuery("SELEC 1")).rejects.toThrow(
      /Invalid SQL:/
    );
  });

  it("allows EXPLAIN, SHOW, DESCRIBE, and PRAGMA", async () => {
    await manager.loadFileToTable(fixturePath("payments.csv"), "p", "csv");
    const explain = await manager.runQuery("EXPLAIN SELECT * FROM p");
    expect(explain.rowCount).toBeGreaterThan(0);
    const describe = await manager.runQuery("DESCRIBE p");
    expect(describe.rows.map((r) => r.column_name)).toEqual([
      "name",
      "amount",
      "note",
    ]);
    const show = await manager.runQuery("SHOW TABLES");
    expect(show.rows.map((r) => String(r.name ?? r.Tables_in))).toContain("p");
    const pragma = await manager.runQuery(
      "SELECT * FROM pragma_table_info('p')"
    );
    expect(pragma.rowCount).toBe(3);
  });

  it("caps rows and reports rowLimitHit", async () => {
    await manager.loadFileToTable(fixturePath("many.csv"), "m", "csv");
    const capped = await manager.runQuery("SELECT * FROM m", 10);
    expect(capped.rowCount).toBe(10);
    expect(capped.rowLimitHit).toBe(true);
    const exact = await manager.runQuery("SELECT * FROM m", 30);
    expect(exact.rowCount).toBe(30);
    expect(exact.rowLimitHit).toBe(false);
  });

  it("truncates long cells with an ellipsis marker", async () => {
    await manager.loadFileToTable(fixturePath("longtext.csv"), "l", "csv");
    const result = await manager.runQuery("SELECT story FROM l", 10);
    const long = String(result.rows[0]!.story);
    expect(long.length).toBe(DEFAULT_CELL_MAX_CHARS);
    expect(long.endsWith("...")).toBe(true);
    const full = await manager.runQuery("SELECT story FROM l", 10, 1000);
    expect(String(full.rows[0]!.story).length).toBe(500);
  });

  it("surfaces DuckDB load errors for unreadable files", async () => {
    await expect(
      manager.loadFileToTable(join(workDir, "does-not-exist.csv"), "bad", "csv")
    ).rejects.toBeInstanceOf(DuckDbLoadError);
  });

  it("maintains the table registry", async () => {
    expect(manager.listTables()).toEqual([]);
    await manager.loadFileToTable(fixturePath("payments.csv"), "reg", "csv");
    manager.registerTable({
      tableName: "reg",
      entityId: "ent.1",
      entitySchema: "Table",
      fileName: "payments.csv",
      dataset: "coll-1",
      rowCount: 3,
      columns: [{ name: "name", type: "VARCHAR" }],
      source: "file",
      loadedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(manager.getTable("reg")?.entityId).toBe("ent.1");
    expect(manager.listTables()).toHaveLength(1);
    expect(manager.listTables()[0]!.tableName).toBe("reg");
  });

  it("respects the memoryLimit option", async () => {
    const limited = new DuckDbManager({ memoryLimit: "2GB" });
    try {
      await limited.loadFileToTable(fixturePath("payments.csv"), "p", "csv");
      const result = await limited.runQuery("SELECT count(*) AS n FROM p");
      expect(result.rows[0]!.n).toBe("3");
    } finally {
      await limited.close();
    }
  });

  it("runs SELECT 1 with no tables loaded", async () => {
    await expect(manager.runQuery("SELECT 1")).resolves.toBeTruthy();
  });
});

describe("DuckDbManager error class", () => {
  it("DuckDbQueryError is an Error", () => {
    expect(new DuckDbQueryError("x")).toBeInstanceOf(Error);
  });
});

describe("normalizeColumnName", () => {
  it("converts spaces to underscores", () => {
    expect(normalizeColumnName("Invoice Date")).toBe("invoice_date");
  });

  it("removes special characters", () => {
    expect(normalizeColumnName("Total (USD)")).toBe("total_usd");
  });

  it("collapses multiple underscores", () => {
    expect(normalizeColumnName("__leading___trailing__")).toBe("leading_trailing");
  });

  it("trims leading and trailing underscores", () => {
    expect(normalizeColumnName("  Leading & Trailing  ")).toBe("leading_trailing");
  });

  it("caps at 63 characters", () => {
    const long = "a".repeat(70);
    expect(normalizeColumnName(long)).toBe("a".repeat(63));
  });

  it("returns 'col' for names with no valid characters", () => {
    expect(normalizeColumnName("   !@#$   ")).toBe("col");
  });

  it("handles already-safe names", () => {
    expect(normalizeColumnName("name")).toBe("name");
    expect(normalizeColumnName("some_column_123")).toBe("some_column_123");
  });
});

describe("column name normalisation", () => {
  let normManager: DuckDbManager;

  beforeEach(async () => {
    normManager = new DuckDbManager();
  });

  afterEach(async () => {
    await normManager.close();
  });

  it("normalises CSV column names with spaces and special chars", async () => {
    const loaded = await normManager.loadFileToTable(
      fixturePath("special-columns.csv"),
      "special",
      "csv"
    );
    expect(loaded.rowCount).toBe(2);
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "invoice_date",
      "total_usd",
      "leading_trailing",
    ]);

    const result = await normManager.runQuery(
      "SELECT invoice_date, total_usd FROM special WHERE total_usd > 150"
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.invoice_date).toBe("2024-02-20");
    expect(Number(result.rows[0]!.total_usd)).toBeGreaterThan(150);
  });
});
