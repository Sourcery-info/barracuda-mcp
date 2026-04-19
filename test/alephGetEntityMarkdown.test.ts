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

  it("isError when Pages has no bodyText, indexText, or rawText", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
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
      expect(result.content[0].text).toContain("No body text");
      expect(result.content[0].text).toContain("indexText");
    }
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
