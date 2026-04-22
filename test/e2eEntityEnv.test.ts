import { describe, expect, it } from "vitest";
import {
  e2eEntityFetchMarkdownFromEnv,
  e2eEntityIdFromEnv,
  e2eEntityShapingFromEnv,
} from "./e2e/e2eEntityEnv.js";

describe("e2eEntityIdFromEnv", () => {
  it("returns undefined when the id is unset or blank", () => {
    expect(e2eEntityIdFromEnv({})).toBeUndefined();
    expect(e2eEntityIdFromEnv({ ALEPH_E2E_ENTITY_ID: "   " })).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(e2eEntityIdFromEnv({ ALEPH_E2E_ENTITY_ID: "  abc.123  " })).toBe(
      "abc.123"
    );
  });
});

describe("e2eEntityFetchMarkdownFromEnv", () => {
  it("defaults to true", () => {
    expect(e2eEntityFetchMarkdownFromEnv({})).toBe(true);
  });

  it("respects false-like values", () => {
    expect(
      e2eEntityFetchMarkdownFromEnv({ ALEPH_E2E_ENTITY_FETCH_MARKDOWN: "false" })
    ).toBe(false);
    expect(
      e2eEntityFetchMarkdownFromEnv({ ALEPH_E2E_ENTITY_FETCH_MARKDOWN: "0" })
    ).toBe(false);
    expect(
      e2eEntityFetchMarkdownFromEnv({ ALEPH_E2E_ENTITY_FETCH_MARKDOWN: "no" })
    ).toBe(false);
  });

  it("ignores unrecognized values and falls back to true", () => {
    expect(
      e2eEntityFetchMarkdownFromEnv({ ALEPH_E2E_ENTITY_FETCH_MARKDOWN: "nope" })
    ).toBe(true);
  });
});

describe("e2eEntityShapingFromEnv", () => {
  it("returns an empty object when no shaping vars are set", () => {
    expect(e2eEntityShapingFromEnv({})).toEqual({});
  });

  it("parses the same keys as search shaping under its own prefix", () => {
    expect(
      e2eEntityShapingFromEnv({
        ALEPH_E2E_ENTITY_RESPONSE_MODE: "structured",
        ALEPH_E2E_ENTITY_INCLUDE_RAW: "true",
        ALEPH_E2E_ENTITY_INCLUDE_CONTENT_FIELDS: "true",
        ALEPH_E2E_ENTITY_CONTENT_PREVIEW_CHARS: "750",
        ALEPH_E2E_ENTITY_BODY_MARKDOWN_MAX_CHARS: "6000",
        ALEPH_E2E_ENTITY_MAX_ARRAY_VALUES_PER_FIELD: "20",
      })
    ).toEqual({
      responseMode: "structured",
      includeRaw: true,
      includeContentFields: true,
      contentPreviewChars: 750,
      bodyMarkdownMaxChars: 6000,
      maxArrayValuesPerField: 20,
    });
  });

  it("does not pick up search-prefixed shaping vars", () => {
    expect(
      e2eEntityShapingFromEnv({
        ALEPH_E2E_SEARCH_INCLUDE_CONTENT_FIELDS: "true",
        ALEPH_E2E_SEARCH_CONTENT_PREVIEW_CHARS: "500",
      })
    ).toEqual({});
  });
});
