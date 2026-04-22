import { describe, expect, it } from "vitest";
import {
  e2eSearchQueryFromEnv,
  e2eSearchShapingFromEnv,
  entityIdsFromSearchResults,
  parseE2eFetchTopN,
} from "./e2e/e2eSearchEnv.js";

describe("e2eSearchQueryFromEnv", () => {
  it("applies defaults when e2e vars are unset", () => {
    const q = e2eSearchQueryFromEnv({});
    expect(q).toEqual({ q: "test", limit: 5, highlight: true });
  });

  it("disables highlight when ALEPH_E2E_SEARCH_HIGHLIGHT is false", () => {
    const q = e2eSearchQueryFromEnv({
      ALEPH_E2E_SEARCH_HIGHLIGHT: "false",
    });
    expect(q.highlight).toBe(false);
  });

  it("parses optional search parameters", () => {
    const q = e2eSearchQueryFromEnv({
      ALEPH_E2E_SEARCH_Q: "invoice",
      ALEPH_E2E_SEARCH_LIMIT: "25",
      ALEPH_E2E_SEARCH_OFFSET: "10",
      ALEPH_E2E_SEARCH_COLLECTION_ID: "coll-1",
      ALEPH_E2E_SEARCH_SCHEMA: "Email",
      ALEPH_E2E_SEARCH_SCHEMATA: "Pages",
      ALEPH_E2E_SEARCH_FACETS: "languages, countries",
      ALEPH_E2E_SEARCH_EXTRA_FILTERS: '{"mime_type":"application/pdf"}',
      ALEPH_E2E_SEARCH_HIGHLIGHT_COUNT: "15",
      ALEPH_E2E_SEARCH_HIGHLIGHT_LENGTH: "300",
    });
    expect(q).toEqual({
      q: "invoice",
      limit: 25,
      offset: 10,
      collectionId: "coll-1",
      schema: "Email",
      schemata: "Pages",
      facets: ["languages", "countries"],
      extraFilters: { mime_type: "application/pdf" },
      highlight: true,
      highlightCount: 15,
      highlightLength: 300,
    });
  });
});

describe("e2eSearchShapingFromEnv", () => {
  it("returns an empty object when no shaping vars are set", () => {
    expect(e2eSearchShapingFromEnv({})).toEqual({});
  });

  it("parses all supported shaping vars", () => {
    expect(
      e2eSearchShapingFromEnv({
        ALEPH_E2E_SEARCH_RESPONSE_MODE: "raw",
        ALEPH_E2E_SEARCH_INCLUDE_RAW: "true",
        ALEPH_E2E_SEARCH_INCLUDE_CONTENT_FIELDS: "true",
        ALEPH_E2E_SEARCH_CONTENT_PREVIEW_CHARS: "500",
        ALEPH_E2E_SEARCH_BODY_MARKDOWN_MAX_CHARS: "1000",
        ALEPH_E2E_SEARCH_MAX_ARRAY_VALUES_PER_FIELD: "25",
      })
    ).toEqual({
      responseMode: "raw",
      includeRaw: true,
      includeContentFields: true,
      contentPreviewChars: 500,
      bodyMarkdownMaxChars: 1000,
      maxArrayValuesPerField: 25,
    });
  });

  it("accepts common boolean spellings and ignores invalid values", () => {
    expect(
      e2eSearchShapingFromEnv({
        ALEPH_E2E_SEARCH_INCLUDE_CONTENT_FIELDS: "FALSE",
        ALEPH_E2E_SEARCH_INCLUDE_RAW: "maybe",
        ALEPH_E2E_SEARCH_RESPONSE_MODE: "bogus",
        ALEPH_E2E_SEARCH_CONTENT_PREVIEW_CHARS: "0",
      })
    ).toEqual({ includeContentFields: false, contentPreviewChars: 0 });
  });

  it("caps large numeric values at their safe maxima", () => {
    expect(
      e2eSearchShapingFromEnv({
        ALEPH_E2E_SEARCH_CONTENT_PREVIEW_CHARS: "999999",
        ALEPH_E2E_SEARCH_BODY_MARKDOWN_MAX_CHARS: "999999",
        ALEPH_E2E_SEARCH_MAX_ARRAY_VALUES_PER_FIELD: "999",
      })
    ).toEqual({
      contentPreviewChars: 50_000,
      bodyMarkdownMaxChars: 50_000,
      maxArrayValuesPerField: 200,
    });
  });
});

describe("parseE2eFetchTopN / entityIdsFromSearchResults", () => {
  it("defaults fetch count to 2 and caps high values", () => {
    expect(parseE2eFetchTopN({})).toBe(2);
    expect(parseE2eFetchTopN({ ALEPH_E2E_FETCH_TOP_N: "5" })).toBe(5);
    expect(parseE2eFetchTopN({ ALEPH_E2E_FETCH_TOP_N: "999" })).toBe(50);
  });

  it("extracts ids from search results up to max", () => {
    const data = {
      results: [{ id: "a" }, { id: "b" }, { id: "c" }],
    };
    expect(entityIdsFromSearchResults(data, 2)).toEqual(["a", "b"]);
    expect(entityIdsFromSearchResults(data, 10)).toEqual(["a", "b", "c"]);
  });
});
