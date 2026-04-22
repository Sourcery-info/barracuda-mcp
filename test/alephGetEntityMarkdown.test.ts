import { describe, expect, it, vi } from "vitest";
import { AlephClient, type FetchLike } from "../src/aleph/client.js";
import { runAlephGetEntityMarkdownTool } from "../src/mcp/alephGetEntityMarkdown.js";
import { testConfig } from "./fixtures.js";

describe("runAlephGetEntityMarkdownTool", () => {
  it("returns full bodyMarkdown for Email with bodyHtml", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(
        JSON.stringify({
          id: "mail-1",
          schema: "Email",
          properties: { bodyHtml: ["<p>Hello <strong>world</strong></p>"] },
        }),
        { status: 200 }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityMarkdownTool(client, { id: "mail-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.id).toBe("mail-1");
      expect(parsed.schema).toBe("Email");
      expect(typeof parsed.bodyMarkdown).toBe("string");
      expect(String(parsed.bodyMarkdown)).toContain("**world**");
      expect(parsed.bodyMarkdownFullChars).toBe(String(parsed.bodyMarkdown).length);
      expect(parsed.htmlSourceTruncated).toBe(false);
    }
  });

  it("returns full plain bodyText for Pages", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(
        JSON.stringify({
          id: "pages-1",
          schema: "Pages",
          properties: { title: ["X"], bodyText: ["Chapter one.\n\nChapter two."] },
        }),
        { status: 200 }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityMarkdownTool(client, { id: "pages-1" });
    expect(result.isError).toBeFalsy();
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.schema).toBe("Pages");
      expect(String(parsed.bodyText)).toContain("Chapter one");
      expect(parsed.bodyMarkdown).toBeUndefined();
      expect(parsed.bodyTextFullChars).toBe(String(parsed.bodyText).length);
      expect(parsed.htmlSourceTruncated).toBe(false);
    }
  });

  it("returns full plain bodyText for Page (single-page schema)", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(
        JSON.stringify({
          id: "page-1",
          schema: "Page",
          properties: { index: [2], bodyText: ["Shard text."] },
        }),
        { status: 200 }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityMarkdownTool(client, { id: "page-1" });
    expect(result.isError).toBeFalsy();
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.schema).toBe("Page");
      expect(String(parsed.bodyText)).toContain("Shard");
    }
  });

  it("returns full plain bodyText for Pages when only indexText is set", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(
        JSON.stringify({
          id: "pages-ix",
          schema: "Pages",
          properties: { title: ["X"], indexText: ["Full text from indexText field."] },
        }),
        { status: 200 }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityMarkdownTool(client, { id: "pages-ix" });
    expect(result.isError).toBeFalsy();
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(String(parsed.bodyText)).toContain("indexText field");
    }
  });

  it("isError when Pages has no bodyText, indexText, or rawText and no child pages", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/search")) {
        return new Response(JSON.stringify({ total: 0, results: [] }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          id: "pages-empty",
          schema: "Pages",
          properties: { title: ["X"] },
        }),
        { status: 200 }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityMarkdownTool(client, { id: "pages-empty" });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.type).toBe("text");
    if (result.content?.[0]?.type === "text") {
      const text = result.content[0].text;
      expect(text).toContain("No body text");
      expect(text).toContain("indexText");
      // Lists present property keys so the caller can see what Aleph returned.
      expect(text).toContain("title");
      // Documents the child-pages query we tried.
      expect(text).toContain("filter:schema=Page");
      expect(text).toContain("filter:properties.document=");
    }
  });

  it("falls back to child Page entities when a Pages parent has no own body text", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const href = String(url);
      if (href.includes("/api/2/search")) {
        // Simulate OpenAleph returning child Page entities in arbitrary order
        // (we should sort by properties.index before concatenating).
        return new Response(
          JSON.stringify({
            total: 2,
            results: [
              {
                id: "child.2",
                schema: "Page",
                properties: {
                  index: [2],
                  bodyText: ["Second page body."],
                  document: ["doc.123"],
                },
              },
              {
                id: "child.1",
                schema: "Page",
                properties: {
                  index: [1],
                  bodyText: ["First page body."],
                  document: ["doc.123"],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          id: "doc.123",
          schema: "Pages",
          properties: { fileName: ["report.pdf"] },
        }),
        { status: 200 }
      );
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityMarkdownTool(client, { id: "doc.123" });
    expect(result.isError).toBeFalsy();
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.schema).toBe("Pages");
      const body = String(parsed.bodyText);
      expect(body.indexOf("First page")).toBeLessThan(body.indexOf("Second page"));
      expect(parsed.bodyTextFromChildren).toBe(true);
      expect(parsed.childPageCount).toBe(2);
      expect(parsed.bodyTextFullChars).toBe(body.length);
    }

    // Confirm the child search used the same HTTP filters as the OpenAleph UI:
    //   filter:schema=Page & filter:properties.document=<id>
    const searchCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/api/2/search")
    );
    expect(searchCalls.length).toBeGreaterThan(0);
    const searchUrlObj = new URL(String(searchCalls[0]![0]));
    expect(searchUrlObj.searchParams.get("filter:schema")).toBe("Page");
    expect(searchUrlObj.searchParams.get("filter:properties.document")).toBe(
      "doc.123"
    );
  });

  it("includes raw when includeRaw is true", async () => {
    const rawEntity = {
      id: "m2",
      schema: "Email",
      properties: { bodyHtml: ["<p>Hi</p>"] },
    };
    const fetchMock = vi.fn<FetchLike>(async () => {
      return new Response(JSON.stringify(rawEntity), { status: 200 });
    });
    const client = new AlephClient(testConfig(), fetchMock);
    const result = await runAlephGetEntityMarkdownTool(client, {
      id: "m2",
      includeRaw: true,
    });
    expect(result.isError).toBeFalsy();
    if (result.content?.[0]?.type === "text") {
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.raw).toEqual(rawEntity);
    }
  });
});
