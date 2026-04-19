import { describe, expect, it, vi } from "vitest";
import { AlephClient } from "../src/aleph/client.js";
import { runAlephSearchTool } from "../src/mcp/alephSearch.js";
import { testConfig } from "./fixtures.js";

describe("runAlephSearchTool", () => {
  it("returns structured JSON content by default", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          status: "ok",
          total: 1,
          results: [
            {
              id: "1",
              schema: "Email",
              properties: {
                subject: ["Hi"],
                bodyHtml: ["<p>Long</p>"],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephSearchTool(client, { q: "foo" });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    expect(String(firstCall[0])).toContain("highlight=true");
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.type).toBe("text");
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
      const rows = parsed as Array<Record<string, unknown>>;
      expect(rows[0]?.schema).toBe("Email");
      const properties = rows[0]?.properties as Record<string, unknown>;
      expect(properties.bodyHtml).toBeUndefined();
    }
  });

  it("returns raw payload when responseMode=raw", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ total: 2, results: [{ id: "1" }] }), {
        status: 200,
      });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephSearchTool(client, { q: "foo", responseMode: "raw" });
    if (result.content?.[0]?.type === "text") {
      expect(JSON.parse(result.content[0].text)).toEqual({
        total: 2,
        results: [{ id: "1" }],
      });
    }
  });

  it("returns isError for invalid args", async () => {
    const client = new AlephClient(testConfig(), vi.fn());
    const result = await runAlephSearchTool(client, { q: "" });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.type).toBe("text");
    if (result.content?.[0]?.type === "text") {
      expect(result.content[0].text).toContain("Invalid arguments");
    }
  });

  it("returns isError with Aleph body on HTTP error", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "error" }), { status: 401 });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephSearchTool(client, { q: "x" });
    expect(result.isError).toBe(true);
    if (result.content?.[0]?.type === "text") {
      expect(result.content[0].text).toContain("401");
      expect(result.content[0].text).toContain("status");
    }
  });

  it("supports including content fields", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          status: "ok",
          total: 1,
          results: [
            {
              id: "1",
              schema: "Email",
              properties: { bodyHtml: ["<p>Long</p>"] },
            },
          ],
        }),
        { status: 200 }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephSearchTool(client, {
      q: "x",
      includeContentFields: true,
    });
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
      const rows = parsed as Array<Record<string, unknown>>;
      const properties = rows[0]?.properties as Record<string, unknown>;
      expect(properties.bodyHtml).toEqual(["<p>Long</p>"]);
    }
  });
});
