import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlephClient, type FetchLike } from "../src/aleph/client.js";
import { runAlephLoadCsvTool } from "../src/mcp/alephLoadCsv.js";
import { DuckDbManager } from "../src/duckdb/manager.js";
import { testConfig } from "./fixtures.js";

const CSV_BODY = "name,amount\nfoo,10\nbar,20\n";
const ENTITY_TABLE_ID = "tbl.111";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function tableEntity(): Record<string, unknown> {
  return {
    id: ENTITY_TABLE_ID,
    schema: "Table",
    collection_id: "coll-1",
    properties: {
      fileName: ["payments.csv"],
      title: ["Payments"],
    },
    links: {
      csv: "https://aleph.test/api/2/archive?entity=tbl&prop=csvHash",
      self: "https://aleph.test/api/2/entities/tbl.111",
    },
  };
}

describe("runAlephLoadCsvTool", () => {
  let manager: DuckDbManager;

  beforeEach(() => {
    manager = new DuckDbManager();
  });

  afterEach(async () => {
    await manager.close();
  });

  it("downloads the archive CSV (auth on hop 1 only) and loads it", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/entities/")) {
        return jsonResponse(tableEntity());
      }
      if (href.includes("/api/2/archive")) {
        // 302 to a signed URL, like the Aleph archive API.
        return new Response(null, {
          status: 302,
          headers: { location: "https://s3.example.org/signed.csv?sig=abc" },
        });
      }
      return new Response(CSV_BODY, { status: 200 });
    });
    const client = new AlephClient(testConfig(), fetchMock);

    const result = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: ENTITY_TABLE_ID,
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content?.[0] as { text: string }).text
    ) as Record<string, unknown>;
    expect(parsed.table).toBe("t_tbl_111");
    expect(parsed.source).toBe("file");
    expect(parsed.rowCount).toBe(2);
    expect(parsed.bytesDownloaded).toBeGreaterThan(0);
    expect(parsed.reused).toBe(false);
    const columns = parsed.columns as { name: string; type: string }[];
    expect(columns.map((c) => c.name)).toEqual(["name", "amount"]);
    const sample = parsed.sample as { name: string }[];
    expect(sample[0]!.name).toBe("foo");

    // Auth headers on the Aleph archive hop…
    const archiveCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/api/2/archive")
    )!;
    const archiveHeaders = (archiveCall[1] as RequestInit).headers as Headers;
    expect(archiveHeaders.get("authorization")).toBe("ApiKey test-api-key");
    // …but NOT on the signed redirect target.
    const s3Call = fetchMock.mock.calls.find(([u]) =>
      String(u).startsWith("https://s3.example.org")
    )!;
    const s3Headers = (s3Call[1] as RequestInit).headers as Headers;
    expect(s3Headers.get("authorization")).toBeNull();
    expect(s3Headers.get("x-aleph-session")).toBeNull();
  });

  it("follows same-origin redirect chains without leaking auth", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/entities/")) {
        return jsonResponse(tableEntity());
      }
      if (href === "https://aleph.test/api/2/archive?entity=tbl&prop=csvHash") {
        return new Response(null, {
          status: 302,
          headers: { location: "/api/2/archive/resolve?file=abc" },
        });
      }
      if (href.includes("/api/2/archive/resolve")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://s3.example.org/signed.csv?sig=abc" },
        });
      }
      return new Response(CSV_BODY, { status: 200 });
    });
    const client = new AlephClient(testConfig(), fetchMock);

    const result = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: ENTITY_TABLE_ID,
      alias: "Payments Table!",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content?.[0] as { text: string }).text
    ) as Record<string, unknown>;
    // alias sanitized to a safe identifier
    expect(parsed.table).toBe("payments_table");

    for (const [url, init] of fetchMock.mock.calls) {
      if (String(url).includes("/api/2/entities/")) continue;
      const headers = (init as RequestInit).headers as Headers;
      const isAlephApiHop =
        String(url).includes("/api/2/archive?entity=") &&
        (init as RequestInit).redirect === "manual" &&
        headers.get("authorization") !== null;
      if (!isAlephApiHop) {
        expect(headers.get("authorization")).toBeNull();
      }
    }
  });

  it("reconstructs rows via paginated Row search when no file link exists", async () => {
    const rowsPage = (offset: number, total: number) => {
      const results = [offset, offset + 1].map((i) => ({
        id: `row.${i}`,
        schema: "Row",
        properties: {
          csv: [ENTITY_TABLE_ID],
          row: [i],
          name: [`person-${i}`],
        },
      }));
      return { total, results };
    };
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/entities/")) {
        const entity = tableEntity();
        delete (entity.links as Record<string, unknown>).csv;
        delete (entity.links as Record<string, unknown>).file;
        return jsonResponse(entity);
      }
      if (href.includes("/api/2/search")) {
        const offset = Number(new URL(href).searchParams.get("offset") ?? 0);
        return jsonResponse(rowsPage(offset, 4));
      }
      return new Response("{}", { status: 404 });
    });
    const client = new AlephClient(testConfig(), fetchMock);

    const result = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: ENTITY_TABLE_ID,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content?.[0] as { text: string }).text
    ) as Record<string, unknown>;
    expect(parsed.source).toBe("rows");
    expect(parsed.rowCount).toBe(4);
    const sample = parsed.sample as { _row_index: string; name: string }[];
    // rows sorted by _row_index; BIGINT sample values come back as strings
    expect(sample.map((r) => r.name)).toEqual([
      "person-0",
      "person-1",
      "person-2",
      "person-3",
    ]);

    // Exactly two paginated search calls, both with the exact-term filter.
    const searchCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/api/2/search")
    );
    expect(searchCalls).toHaveLength(2);
    for (const [u] of searchCalls) {
      const params = new URL(String(u)).searchParams;
      expect(params.get("filter:schema")).toBe("Row");
      expect(params.get("filter:properties.csv")).toBe(ENTITY_TABLE_ID);
    }
  });

  it("isError with a helpful hint when a Row id is passed", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({
        id: "row.7",
        schema: "Row",
        properties: { csv: ["tbl.111"], row: [7], name: ["foo"] },
      })
    );
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: "row.7",
    });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("Row entity");
    expect(text).toContain("tbl.111");
  });

  it("isError for non-tabular entities, listing the schema", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({
        id: "person.1",
        schema: "Person",
        properties: { name: ["Jane"] },
      })
    );
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: "person.1",
    });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("not tabular");
    expect(text).toContain("Person");
    expect(text).toContain("name");
  });

  it("aborts and cleans up when the download exceeds the byte cap", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/entities/")) {
        return jsonResponse(tableEntity());
      }
      return new Response("x".repeat(1000), { status: 200 });
    });
    const client = new AlephClient(
      testConfig({ csvMaxBytes: 100 }),
      fetchMock
    );

    const tmpBefore = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("barracuda-")
    ).length;

    const result = await runAlephLoadCsvTool(client, manager, testConfig({ csvMaxBytes: 100 }), {
      id: ENTITY_TABLE_ID,
    });

    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("byte cap");
    expect(text).toContain("ALEPH_CSV_MAX_BYTES");
    expect(manager.listTables()).toHaveLength(0);

    const tmpAfter = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("barracuda-")
    );
    expect(tmpAfter.length).toBe(tmpBefore);
  });

  it("reuses the loaded table without re-fetching unless force=true", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/entities/")) {
        return jsonResponse(tableEntity());
      }
      return new Response(CSV_BODY, { status: 200 });
    });
    const client = new AlephClient(testConfig(), fetchMock);

    const first = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: ENTITY_TABLE_ID,
    });
    expect(first.isError).toBeFalsy();

    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: ENTITY_TABLE_ID,
    });
    expect(second.isError).toBeFalsy();
    const parsed = JSON.parse(
      (second.content?.[0] as { text: string }).text
    ) as Record<string, unknown>;
    expect(parsed.reused).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    const forced = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: ENTITY_TABLE_ID,
      force: true,
    });
    expect(forced.isError).toBeFalsy();
    const forcedParsed = JSON.parse(
      (forced.content?.[0] as { text: string }).text
    ) as Record<string, unknown>;
    expect(forcedParsed.reused).toBe(false);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("passes through Aleph HTTP errors", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ message: "not found" }), { status: 404 })
    );
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: "missing.1",
    });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("HTTP 404");
  });

  it("isError when the Row fallback returns zero rows", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/entities/")) {
        const entity = tableEntity();
        entity.links = { self: "https://aleph.test/api/2/entities/tbl.111" };
        return jsonResponse(entity);
      }
      return jsonResponse({ total: 0, results: [] });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: ENTITY_TABLE_ID,
    });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("No rows reconstructed");
    expect(text).toContain("filter:schema=Row");
    expect(text).toContain(`filter:properties.csv=${ENTITY_TABLE_ID}`);
  });

  it("cleans up temp files after a successful load", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/entities/")) {
        return jsonResponse(tableEntity());
      }
      return new Response(CSV_BODY, { status: 200 });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const before = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("barracuda-")
    ).length;
    await runAlephLoadCsvTool(client, manager, testConfig(), {
      id: ENTITY_TABLE_ID,
    });
    const after = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("barracuda-")
    );
    expect(after.length).toBe(before);
  });

  it("rejects invalid arguments", async () => {
    const client = new AlephClient(testConfig(), async () => {
      throw new Error("should not be called");
    });
    const result = await runAlephLoadCsvTool(client, manager, testConfig(), {});
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toContain(
      "Invalid arguments"
    );
  });
});
