import { describe, expect, it } from "vitest";
import { clampSearchLimit, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("prefers ALEPH_BASE_URL over OPAL_HOST", () => {
    const c = loadConfig(
      {
        ALEPH_BASE_URL: "https://a.example",
        OPAL_HOST: "https://b.example",
        ALEPH_API_KEY: "k",
      },
      "1.0.0"
    );
    expect(c.alephOrigin).toBe("https://a.example");
  });

  it("uses OPAL_* when ALEPH_* unset", () => {
    const c = loadConfig(
      {
        OPAL_HOST: "https://opal.example/path/ignored",
        OPAL_API_KEY: "key",
      },
      "1.0.0"
    );
    expect(c.alephOrigin).toBe("https://opal.example");
    expect(c.apiKey).toBe("key");
  });

  it("prefers ALEPH_API_KEY over OPAL_API_KEY", () => {
    const c = loadConfig(
      {
        ALEPH_BASE_URL: "https://x.org",
        ALEPH_API_KEY: "a",
        OPAL_API_KEY: "b",
      },
      "1.0.0"
    );
    expect(c.apiKey).toBe("a");
  });

  it("throws when host missing", () => {
    expect(() => loadConfig({ ALEPH_API_KEY: "k" }, "1")).toThrow(/host/i);
  });

  it("throws when key missing", () => {
    expect(() => loadConfig({ ALEPH_BASE_URL: "https://x.org" }, "1")).toThrow(
      /API key/i
    );
  });

  it("defaults csvMaxBytes when ALEPH_CSV_MAX_BYTES unset", () => {
    const c = loadConfig(
      { ALEPH_BASE_URL: "https://x.org", ALEPH_API_KEY: "k" },
      "1"
    );
    expect(c.csvMaxBytes).toBe(524_288_000);
    expect(c.duckdbMemoryLimit).toBeUndefined();
  });

  it("clamps ALEPH_CSV_MAX_BYTES to the 1 MB minimum", () => {
    const c = loadConfig(
      {
        ALEPH_BASE_URL: "https://x.org",
        ALEPH_API_KEY: "k",
        ALEPH_CSV_MAX_BYTES: "10",
      },
      "1"
    );
    expect(c.csvMaxBytes).toBe(1_048_576);
  });

  it("throws on non-numeric ALEPH_CSV_MAX_BYTES", () => {
    expect(() =>
      loadConfig(
        {
          ALEPH_BASE_URL: "https://x.org",
          ALEPH_API_KEY: "k",
          ALEPH_CSV_MAX_BYTES: "big",
        },
        "1"
      )
    ).toThrow(/ALEPH_CSV_MAX_BYTES/);
  });

  it("accepts ALEPH_DUCKDB_MEMORY_LIMIT like 2GB", () => {
    const c = loadConfig(
      {
        ALEPH_BASE_URL: "https://x.org",
        ALEPH_API_KEY: "k",
        ALEPH_DUCKDB_MEMORY_LIMIT: "2gb",
      },
      "1"
    );
    expect(c.duckdbMemoryLimit).toBe("2GB");
  });

  it("throws on malformed ALEPH_DUCKDB_MEMORY_LIMIT", () => {
    expect(() =>
      loadConfig(
        {
          ALEPH_BASE_URL: "https://x.org",
          ALEPH_API_KEY: "k",
          ALEPH_DUCKDB_MEMORY_LIMIT: "a lot",
        },
        "1"
      )
    ).toThrow(/ALEPH_DUCKDB_MEMORY_LIMIT/);
  });
});

describe("clampSearchLimit", () => {
  it("clamps to 10000", () => {
    expect(clampSearchLimit(999_999)).toBe(10_000);
  });
  it("returns undefined for undefined", () => {
    expect(clampSearchLimit(undefined)).toBeUndefined();
  });
});
