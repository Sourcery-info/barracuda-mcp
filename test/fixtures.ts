import type { AppConfig } from "../src/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    alephOrigin: "https://aleph.test",
    apiKey: "test-api-key",
    requestTimeoutMs: 10_000,
    sessionId: "session-fixture",
    userAgent: "barracuda-mcp/test",
    ...overrides,
  };
}
