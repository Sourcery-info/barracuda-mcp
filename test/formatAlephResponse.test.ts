import { describe, expect, it } from "vitest";
import type { FormatterOptions } from "../src/mcp/formatAlephResponse.js";
import {
  formatAlephStructuredResponse,
  formatEntityGetResponse,
  getCanonicalEntityId,
  SEARCH_DEFAULT_BODY_MARKDOWN_MAX_CHARS,
} from "../src/mcp/formatAlephResponse.js";

function fmt(overrides: Partial<FormatterOptions> = {}): FormatterOptions {
  return {
    filtersApplied: {},
    includeRaw: false,
    includeContentFields: false,
    contentPreviewChars: 0,
    maxArrayValuesPerField: 20,
    bodyMarkdownMaxChars: 6000,
    ...overrides,
  };
}

const sample = {
  status: "ok",
  total: 2,
  offset: 0,
  limit: 10,
  results: [
    {
      id: "email-1",
      schema: "Email",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
      properties: {
        subject: ["FW: Donald Trump"],
        from: ["Jane <jane@example.org>"],
        to: ["Frank"],
        peopleMentioned: ["Jane", "Frank"],
        bodyHtml: ["<html>Long content</html>"],
      },
    },
    {
      id: "person-1",
      schema: "Person",
      properties: {
        name: ["Jane French"],
        alias: ["J. French"],
      },
    },
  ],
};

describe("formatAlephStructuredResponse", () => {
  it("returns a bare array of slim hits", () => {
    const result = formatAlephStructuredResponse(sample, { ...fmt(), query: "jane" });
    expect(Array.isArray(result)).toBe(true);
    const rows = result as Array<Record<string, unknown>>;
    expect(rows[0]?.schema).toBe("Email");
    const p0 = rows[0]?.properties as Record<string, unknown>;
    expect(p0.bodyHtml).toBeUndefined();
    const md = p0.bodyMarkdown as string[];
    expect(Array.isArray(md)).toBe(true);
    expect(md[0]).toContain("Long content");
    expect(p0.subject).toEqual(["FW: Donald Trump"]);
    expect(rows[1]?.schema).toBe("Person");
    const p1 = rows[1]?.properties as Record<string, unknown>;
    expect(p1.name).toEqual(["Jane French"]);
  });

  it("truncates Email bodyMarkdown when contentPreviewChars is set (near paragraph/line breaks)", () => {
    const result = formatAlephStructuredResponse(sample, {
      ...fmt(),
      query: "jane",
      contentPreviewChars: 8,
    });
    const rows = result as Array<Record<string, unknown>>;
    const hit = rows[0] as Record<string, unknown>;
    const properties = hit.properties as Record<string, unknown>;
    const md = properties.bodyMarkdown as string[];
    expect(md[0]).toMatch(/…/);
    expect(md[0].length).toBeLessThanOrEqual(32);
    expect(hit.truncatedBody).toBe(true);
    expect(typeof hit.bodyMarkdownFullChars).toBe("number");
    expect(typeof hit.bodyMarkdownReturnedChars).toBe("number");
    expect(hit.bodyMarkdownReturnedChars).toBeLessThan(hit.bodyMarkdownFullChars as number);
  });

  it("sets truncatedBody false and matching char counts when bodyMarkdown is not shortened", () => {
    const result = formatAlephStructuredResponse(sample, {
      ...fmt(),
      query: "jane",
      bodyMarkdownMaxChars: 50_000,
    });
    const hit = (result as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(hit.truncatedBody).toBe(false);
    expect(hit.bodyMarkdownFullChars).toBe(hit.bodyMarkdownReturnedChars);
  });

  it("drops conflicting bodyMarkdown HTML when bodyHtml is converted to Markdown", () => {
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            schema: "Email",
            properties: {
              bodyHtml: ["<p>From bodyHtml</p>"],
              bodyMarkdown: ["<div>must not leak</div>"],
            },
          },
        ],
      },
      { ...fmt(), query: "x" }
    );
    const props = (result as Array<Record<string, unknown>>)[0]?.properties as Record<
      string,
      unknown
    >;
    const md = props.bodyMarkdown as string[];
    expect(md[0]).not.toContain("must not leak");
    expect(md[0]).not.toContain("<div>");
    expect(md[0]).toContain("From bodyHtml");
  });

  it("converts Email bodyHtml to Markdown and omits raw bodyHtml when includeContentFields is false", () => {
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            id: "m1",
            schema: "Email",
            properties: {
              bodyHtml: ["<p>Hello <strong>world</strong></p>"],
            },
          },
        ],
      },
      { ...fmt(), query: "x" }
    );
    const rows = result as Array<Record<string, unknown>>;
    const props = rows[0]?.properties as Record<string, unknown>;
    expect(props.bodyHtml).toBeUndefined();
    expect((props.bodyMarkdown as string[])[0]).toContain("**world**");
  });

  it("strips Outlook/Word HTML comment CSS so bodyMarkdown is not raw HTML/CSS", () => {
    const outlookNoise = `<!-- /* Font Definitions */ @font-face {font-family:"Calibria"; panose-1:2 4 5 3 5 4 6 3 2 4;} --><div class="WordSection1"><p class="MsoNormal">Real message text here.</p></div>`;
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            schema: "Email",
            properties: { bodyHtml: [outlookNoise] },
          },
        ],
      },
      { ...fmt(), query: "x" }
    );
    const props = (result as Array<Record<string, unknown>>)[0]?.properties as Record<
      string,
      unknown
    >;
    const md = (props.bodyMarkdown as string[])[0];
    expect(md).toContain("Real message text");
    expect(md).not.toMatch(/@font-face|panose-|Font Definitions/i);
    expect(md).not.toMatch(/^<!--/);
  });

  it("keeps full bodyHtml for Email when includeContentFields is true", () => {
    const html = "<p>Full</p>";
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            schema: "Email",
            properties: { bodyHtml: [html] },
          },
        ],
      },
      { ...fmt(), query: "x", includeContentFields: true }
    );
    const rows = result as Array<Record<string, unknown>>;
    const props = rows[0]?.properties as Record<string, unknown>;
    expect(props.bodyHtml).toEqual([html]);
    expect(props.bodyMarkdown).toBeUndefined();
  });

  it("includes raw payload when requested", () => {
    const result = formatAlephStructuredResponse(sample, {
      ...fmt(),
      query: "jane",
      includeRaw: true,
    }) as Record<string, unknown>;
    expect(result.raw).toEqual(sample);
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("serializes nested entity objects instead of [object Object]", () => {
    const nested = formatAlephStructuredResponse(
      {
        status: "ok",
        total: 1,
        results: [
          {
            id: "e1",
            schema: "Email",
            properties: {
              relatedEntities: [
                {
                  id: "p1",
                  schema: "Person",
                  properties: { name: ["Alice Example"] },
                },
              ],
              plainObject: [{ note: "nested" }],
            },
          },
        ],
      },
      { ...fmt(), query: "test" }
    );
    const rows = nested as Array<Record<string, unknown>>;
    const properties = rows[0]?.properties as Record<string, unknown>;
    const related = properties.relatedEntities as string[];
    expect(related[0]).toBe("Alice Example");
    expect(related[0]).not.toContain("object Object");
    const plain = properties.plainObject as string[];
    expect(plain[0]).toContain("nested");
    expect(plain[0]).not.toContain("object Object");
  });

  it("resolves id from links.self and exposes link from links.ui", () => {
    const full =
      "https://bar.openaleph.example/api/2/entities/12760726.82fbd81872e6c1b47132fe839c6d4fa9d1da5cb8";
    const ui =
      "https://bar.openaleph.example/entities/12760726.82fbd81872e6c1b47132fe839c6d4fa9d1da5cb8";
    expect(
      getCanonicalEntityId({
        schema: "Pages",
        links: {
          self: full,
          ui,
        },
      })
    ).toBe("12760726.82fbd81872e6c1b47132fe839c6d4fa9d1da5cb8");

    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        total: 1,
        results: [
          {
            schema: "Pages",
            links: { self: full, ui },
            properties: { title: ["Memo"] },
          },
        ],
      },
      { ...fmt(), query: "x" }
    );
    const rows = result as Array<Record<string, unknown>>;
    expect(rows[0]?.id).toBe("12760726.82fbd81872e6c1b47132fe839c6d4fa9d1da5cb8");
    expect(rows[0]?.link).toBe(ui);
  });

  it("compresses parent, ancestors, and recipients", () => {
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        total: 1,
        results: [
          {
            id: "e1",
            schema: "Email",
            properties: {
              processingAgent: ["agent"],
              processingStatus: ["done"],
              parent: {
                id: "p1",
                schema: "Folder",
                caption: "Inbox",
                extra: "drop",
              },
              ancestors: [
                { id: "a1", schema: "Thing", caption: "Root" },
              ],
              recipients: [
                {
                  id: "r1",
                  schema: "Person",
                  properties: {
                    name: ["Bob"],
                    email: ["bob@example.org"],
                  },
                },
              ],
            },
          },
        ],
      },
      { ...fmt(), query: "q" }
    );
    const rows = result as Array<Record<string, unknown>>;
    const props = rows[0]?.properties as Record<string, unknown>;
    expect(props.processingAgent).toBeUndefined();
    expect(props.processingStatus).toBeUndefined();
    expect(props.parent).toEqual({
      schema: "Folder",
      caption: "Inbox",
      id: "p1",
    });
    expect(props.ancestors).toEqual([
      { schema: "Thing", caption: "Root", id: "a1" },
    ]);
    expect(props.recipients).toEqual([
      { schema: "Person", id: "r1", name: "Bob", email: "bob@example.org" },
    ]);
  });

  it("truncates Page (single-page entity) bodyText like Pages", () => {
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            id: "page-1",
            schema: "Page",
            properties: {
              index: [1],
              bodyText: ["Line from a Page entity."],
            },
          },
        ],
      },
      { ...fmt(), query: "x" }
    );
    const row = (result as Array<Record<string, unknown>>)[0];
    expect(row.schema).toBe("Page");
    const props = row?.properties as Record<string, unknown>;
    expect((props.bodyText as string[])[0]).toContain("Page entity");
  });

  it("uses Pages indexText when bodyText is absent (Aleph index pattern)", () => {
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            id: "pages-ix",
            schema: "Pages",
            properties: {
              title: ["X"],
              indexText: ["Indexed OCR paragraph one.\n\nParagraph two."],
            },
          },
        ],
      },
      { ...fmt(), query: "x" }
    );
    const row = (result as Array<Record<string, unknown>>)[0];
    const props = row?.properties as Record<string, unknown>;
    expect(props.indexText).toBeUndefined();
    expect((props.bodyText as string[])[0]).toContain("OCR paragraph");
    expect(row.bodyTextFromSearchHighlight).toBeUndefined();
  });

  it("uses search highlight when Pages has no body fields (snippet preview)", () => {
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            id: "pages-hl",
            schema: "Pages",
            properties: { title: ["Memo"] },
            highlight: [
              "The <em>keyword</em> appears in this fragment.",
              "Another <em>keyword</em> line.",
            ],
          },
        ],
      },
      { ...fmt(), query: "keyword" }
    );
    const row = (result as Array<Record<string, unknown>>)[0];
    const props = row?.properties as Record<string, unknown>;
    expect((props.bodyText as string[])[0]).toContain("keyword");
    expect(row.bodyTextFromSearchHighlight).toBe(true);
    expect(row.highlight).toEqual([
      "The <em>keyword</em> appears in this fragment.",
      "Another <em>keyword</em> line.",
    ]);
  });

  it("passes through highlight alongside truncated Page bodyText", () => {
    const longBody = `${"paragraph ".repeat(50)}`;
    const hl = ["… match in <em>paragraph</em> …"];
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            id: "p1",
            schema: "Page",
            properties: { bodyText: [longBody] },
            highlight: hl,
          },
        ],
      },
      { ...fmt(), query: "paragraph", bodyMarkdownMaxChars: 80 }
    );
    const row = (result as Array<Record<string, unknown>>)[0];
    expect(row.truncatedBody).toBe(true);
    expect(row.highlight).toEqual(hl);
  });

  it("truncates Pages bodyText with the same boundary rules as Email bodyMarkdown", () => {
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          {
            id: "pages-1",
            schema: "Pages",
            properties: {
              title: ["Memo"],
              bodyText: ["Section A\n\nSection B with text."],
            },
          },
        ],
      },
      { ...fmt(), query: "memo" }
    );
    const row = (result as Array<Record<string, unknown>>)[0];
    const props = row?.properties as Record<string, unknown>;
    expect(props.bodyMarkdown).toBeUndefined();
    expect((props.bodyText as string[])[0]).toContain("Section A");
    expect((props.bodyText as string[])[0]).toContain("Section B");
    expect(row.truncatedBody).toBe(false);
  });

  it("truncates Email bodyMarkdown to bodyMarkdownMaxChars (search default is aggressive)", () => {
    const longHtml = `<p>${"word ".repeat(80)}</p>`;
    const result = formatAlephStructuredResponse(
      {
        status: "ok",
        results: [
          { id: "e", schema: "Email", properties: { bodyHtml: [longHtml] } },
        ],
      },
      { ...fmt(), query: "x", bodyMarkdownMaxChars: SEARCH_DEFAULT_BODY_MARKDOWN_MAX_CHARS }
    );
    const md = (result as Array<Record<string, unknown>>)[0]?.properties as Record<
      string,
      unknown
    >;
    expect(((md.bodyMarkdown as string[])[0] as string).length).toBeLessThan(
      SEARCH_DEFAULT_BODY_MARKDOWN_MAX_CHARS + 30
    );
  });
});

describe("formatEntityGetResponse", () => {
  it("converts Email bodyHtml to bodyMarkdown like structured search hits", () => {
    const raw = {
      id: "mail-1",
      schema: "Email",
      properties: { bodyHtml: ["<p>Single <strong>entity</strong> body</p>"] },
    };
    const slim = formatEntityGetResponse(raw, {
      ...fmt(),
      entityId: "mail-1",
      filtersApplied: { id: "mail-1" },
    });
    const props = slim.properties as Record<string, unknown>;
    expect(props.bodyHtml).toBeUndefined();
    expect((props.bodyMarkdown as string[])[0]).toContain("**entity**");
  });

  it("returns truncated Pages bodyText like structured search hits", () => {
    const raw = {
      id: "pages-2",
      schema: "Pages",
      properties: { title: ["Report"], bodyText: ["Plain body line."] },
    };
    const slim = formatEntityGetResponse(raw, {
      ...fmt(),
      entityId: "pages-2",
      filtersApplied: { id: "pages-2" },
    });
    const props = slim.properties as Record<string, unknown>;
    expect((props.bodyText as string[])[0]).toContain("Plain body line.");
    expect(props.bodyMarkdown).toBeUndefined();
  });
});
