import { describe, expect, it, vi } from "vitest";
import { AlephClient, type FetchLike } from "../src/aleph/client.js";
import { runAlephGetEntityTool } from "../src/mcp/alephGetEntity.js";
import { testConfig } from "./fixtures.js";

describe("runAlephGetEntityTool", () => {
  it("calls GET /api/2/entities/:id and returns structured result by default", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(
        JSON.stringify({
          id: "pages-1",
          schema: "Pages",
          properties: { title: ["Report"], bodyText: ["long text"] },
        }),
        { status: 200 }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityTool(client, { id: "pages-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://aleph.test/api/2/entities/pages-1");
    expect(result.isError).toBeFalsy();
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.schema).toBe("Pages");
      const properties = parsed.properties as Record<string, unknown>;
      expect(properties.bodyText).toEqual(["long text"]);
    }
  });

  it("returns raw Aleph JSON when responseMode is raw", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(JSON.stringify({ id: "x", schema: "Person" }), {
        status: 200,
      });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityTool(client, {
      id: "x",
      responseMode: "raw",
    });
    if (result.content?.[0]?.type === "text") {
      expect(JSON.parse(result.content[0].text)).toEqual({
        id: "x",
        schema: "Person",
      });
    }
  });
});
