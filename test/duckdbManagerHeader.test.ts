import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbManager } from "../src/duckdb/manager.js";

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("CSV header detection", () => {
  let manager: DuckDbManager;

  beforeEach(async () => {
    manager = new DuckDbManager();
  });

  afterEach(async () => {
    await manager.close();
  });

  it("auto-detects normal text headers (existing behavior)", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("payments.csv"),
      "payments",
      "csv"
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "name",
      "amount",
      "note",
    ]);
    expect(loaded.rowCount).toBe(3);
  });

  it("treats mixed text+number first row as DATA (no headers)", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("no-header.csv"),
      "noheader",
      "csv"
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "column0",
      "column1",
      "column2",
    ]);
    expect(loaded.rowCount).toBe(3);
  });

  it("treats all-numeric first row as DATA (no headers)", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("numeric-first-row.csv"),
      "numeric",
      "csv"
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "column0",
      "column1",
      "column2",
    ]);
    expect(loaded.rowCount).toBe(3);
  });

  it("treats all-text first row as HEADER (auto-detected)", async () => {
    // DuckDB treats all-text first rows as headers, so 2 data rows remain
    const loaded = await manager.loadFileToTable(
      fixturePath("text-data-no-header.csv"),
      "textdata",
      "csv"
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
    expect(loaded.rowCount).toBe(2);
  });

  it("DuckDB deduplicates column names with _1, _2 suffixes, normalizer preserves them", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("duplicate-columns.csv"),
      "dup",
      "csv"
    );
    const names = loaded.columns.map((c) => c.name);
    // DuckDB deduplicates: name, name_1, value → normalized: name, name_1, value
    expect(names).toContain("name");
    expect(names).toContain("name_1");
    expect(names).toContain("value");
    expect(names.length).toBe(3);
    expect(loaded.rowCount).toBe(3);
  });

  it("handles empty header names", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("empty-header.csv"),
      "emptyheader",
      "csv"
    );
    expect(loaded.rowCount).toBe(2);
  });

  it("handles mismatched column counts", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("mismatched-columns.csv"),
      "mismatch",
      "csv"
    );
    expect(loaded.rowCount).toBe(3);
    expect(loaded.columns.length).toBeGreaterThan(0);
  });

  it("loads tab-separated files", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("tab-separated.tsv"),
      "tsv",
      "csv"
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "id",
      "name",
      "value",
    ]);
    expect(loaded.rowCount).toBe(3);

    const result = await manager.runQuery('SELECT name FROM tsv WHERE id = 2');
    expect(result.rows).toEqual([{ name: "bar" }]);
  });

  it("loads semicolon-delimited files", async () => {
    const loaded = await manager.loadFileToTable(
      fixturePath("semicolon-delimited.csv"),
      "semicolon",
      "csv"
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "id",
      "name",
      "value",
    ]);
    expect(loaded.rowCount).toBe(3);
  });
});
describe("CSV force-header option (proposed)", () => {
  let manager: DuckDbManager;
  let workDir: string;

  beforeEach(async () => {
    manager = new DuckDbManager();
    workDir = await mkdtemp(join(tmpdir(), "header-test-"));
  });

  afterEach(async () => {
    await manager.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("FORCE_HEADERS=true forces first row as header for no-header CSV", async () => {
    const { writeFileSync } = await import("node:fs");
    const tmpPath = join(workDir, "force-header.csv");
    writeFileSync(tmpPath, "foo,10,first\nbar,20,second\nbaz,30,third\n");

    const loaded = await manager.loadFileToTable(
      tmpPath,
      "force",
      "csv",
      { forceHeaders: true }
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "foo",
      "10",
      "first",
    ]);
    // First row becomes header → 2 data rows remain
    expect(loaded.rowCount).toBe(2);
  });

  it("FORCE_HEADERS=true works for numeric-first-row CSV", async () => {
    const { writeFileSync } = await import("node:fs");
    const tmpPath = join(workDir, "force-numeric.csv");
    writeFileSync(tmpPath, "id,code,value\n1,200,100\n2,300,200\n");

    const loaded = await manager.loadFileToTable(
      tmpPath,
      "numforce",
      "csv",
      { forceHeaders: true }
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "id",
      "code",
      "value",
    ]);
    expect(loaded.rowCount).toBe(2);
  });

  it("FORCE_HEADERS=false forces first row as data for text-header CSV", async () => {
    const { writeFileSync } = await import("node:fs");
    const tmpPath = join(workDir, "no-header-override.csv");
    writeFileSync(
      tmpPath,
      "apple,banana,cherry\ndog,elephant,fox\ngrape,horse,iguana\n"
    );

    const loaded = await manager.loadFileToTable(
      tmpPath,
      "notext",
      "csv",
      { forceNoHeaders: true }
    );
    expect(loaded.columns.map((c) => c.name)).toEqual([
      "column0",
      "column1",
      "column2",
    ]);
    expect(loaded.rowCount).toBe(3);
  });

  it("default (no flags) uses DuckDB auto-detection", async () => {
    const { writeFileSync } = await import("node:fs");
    const tmpPath = join(workDir, "auto.csv");
    writeFileSync(tmpPath, "name,amount\nfoo,10\nbar,20\n");

    const loaded = await manager.loadFileToTable(tmpPath, "auto", "csv");
    expect(loaded.columns.map((c) => c.name)).toEqual(["name", "amount"]);
    expect(loaded.rowCount).toBe(2);
  });
});

