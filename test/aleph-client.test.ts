import { describe, expect, it, vi } from "vitest";
import { AlephClient, AlephHttpError, type FetchLike } from "../src/aleph/client.js";
import { testConfig } from "./fixtures.js";

describe("AlephClient", () => {
  it("buildSearchUrl encodes q, limit, offset, collection, facets, extraFilters", () => {
    const client = new AlephClient(testConfig());
    const url = client.buildSearchUrl({
      q: "penguin",
      limit: 25,
      offset: 10,
      collectionId: "coll-1",
      facets: ["languages", "countries"],
      extraFilters: { mime_type: "application/pdf" },
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://aleph.test/api/2/search");
    expect(u.searchParams.get("q")).toBe("penguin");
    expect(u.searchParams.get("limit")).toBe("25");
    expect(u.searchParams.get("offset")).toBe("10");
    expect(u.searchParams.get("filter:collection_id")).toBe("coll-1");
    expect(u.searchParams.getAll("facet")).toEqual(["languages", "countries"]);
    expect(u.searchParams.get("filter:mime_type")).toBe("application/pdf");
  });

  it("clamps limit to 10000", () => {
    const client = new AlephClient(testConfig());
    const url = client.buildSearchUrl({ q: "a", limit: 999_999 });
    expect(new URL(url).searchParams.get("limit")).toBe("10000");
  });

  it("buildSearchUrl sets highlight params when requested", () => {
    const client = new AlephClient(testConfig());
    const url = client.buildSearchUrl({
      q: "foo",
      highlight: true,
      highlightCount: 15,
      highlightLength: 200,
    });
    const u = new URL(url);
    expect(u.searchParams.get("highlight")).toBe("true");
    expect(u.searchParams.get("highlight_count")).toBe("15");
    expect(u.searchParams.get("highlight_length")).toBe("200");
  });

  it("embeds schemata into q and omits filter:schemata", () => {
    const client = new AlephClient(testConfig());
    const url = client.buildSearchUrl({ q: "penguin", schemata: "Document" });
    const u = new URL(url);
    expect(u.searchParams.get("q")).toBe("(penguin) AND (schemata:Document)");
    expect(u.searchParams.get("filter:schemata")).toBeNull();
  });

  it("does not duplicate schemata clause if already in q", () => {
    const client = new AlephClient(testConfig());
    const url = client.buildSearchUrl({
      q: "schemata:Document",
      schemata: "Document",
    });
    expect(new URL(url).searchParams.get("q")).toBe("schemata:Document");
  });

  it("OR-combines comma-separated schemata into q", () => {
    const client = new AlephClient(testConfig());
    const url = client.buildSearchUrl({ q: "penguin", schemata: "Email,Pages" });
    const u = new URL(url);
    expect(u.searchParams.get("q")).toBe(
      "(penguin) AND (schemata:Email OR schemata:Pages)"
    );
    expect(u.searchParams.get("filter:schemata")).toBeNull();
  });

  it("OR-combines array schemata into q and trims whitespace", () => {
    const client = new AlephClient(testConfig());
    const url = client.buildSearchUrl({
      q: "penguin",
      schemata: [" Email ", "Pages"],
    });
    expect(new URL(url).searchParams.get("q")).toBe(
      "(penguin) AND (schemata:Email OR schemata:Pages)"
    );
  });

  it("uses filter:schema for a single schema and OR-combines multiple into q", () => {
    const client = new AlephClient(testConfig());
    const singleUrl = new URL(
      client.buildSearchUrl({ q: "foo", schema: "Email" })
    );
    expect(singleUrl.searchParams.get("filter:schema")).toBe("Email");
    expect(singleUrl.searchParams.get("q")).toBe("foo");

    const multiUrl = new URL(
      client.buildSearchUrl({ q: "foo", schema: "Email, Pages" })
    );
    expect(multiUrl.searchParams.get("filter:schema")).toBeNull();
    expect(multiUrl.searchParams.get("q")).toBe(
      "(foo) AND (schema:Email OR schema:Pages)"
    );
  });

  it("ignores empty schema entries from comma-separated input", () => {
    const client = new AlephClient(testConfig());
    const url = client.buildSearchUrl({ q: "foo", schemata: " , , " });
    expect(new URL(url).searchParams.get("q")).toBe("foo");
  });

  it("buildEntityUrl encodes entity id for path", () => {
    const client = new AlephClient(testConfig());
    expect(client.buildEntityUrl("abc/def")).toBe(
      "https://aleph.test/api/2/entities/abc%2Fdef"
    );
  });

  it("getEntity requests entities endpoint", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(JSON.stringify({ id: "e1", schema: "Document" }), {
        status: 200,
      });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const data = await client.getEntity("e1");
    expect(data).toEqual({ id: "e1", schema: "Document" });
    const [reqUrl] = fetchMock.mock.calls[0]!;
    expect(String(reqUrl)).toBe("https://aleph.test/api/2/entities/e1");
  });

  it("search sends ApiKey and session headers", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(JSON.stringify({ total: 0, results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    await client.search({ q: "hello" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(reqUrl)).toContain("https://aleph.test/api/2/search?");
    expect(String(reqUrl)).toContain("q=hello");
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("ApiKey test-api-key");
    expect(headers.get("X-Aleph-Session")).toBe("session-fixture");
    expect(headers.get("User-Agent")).toBe("barracuda-mcp/test");
  });

  it("search throws AlephHttpError on non-OK response", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    await expect(client.search({ q: "x" })).rejects.toMatchObject({
      name: "AlephHttpError",
      status: 403,
    });
  });

  it("search maps AbortError to AlephHttpError 408", async () => {
    const fetchMock = vi.fn<FetchLike>(async (_url, init) => {
      const signal = init?.signal;
      if (signal) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      return new Response("{}");
    });
    const client = new AlephClient(testConfig({ requestTimeoutMs: 100 }), fetchMock);
    await expect(client.search({ q: "x" })).rejects.toMatchObject({
      name: "AlephHttpError",
      status: 408,
    });
  });
});

describe("AlephHttpError", () => {
  it("preserves status and body", () => {
    const err = new AlephHttpError("fail", 502, { detail: "bad gateway" });
    expect(err.status).toBe(502);
    expect(err.body).toEqual({ detail: "bad gateway" });
  });
});
