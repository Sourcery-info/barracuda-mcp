#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AlephClient } from "./aleph/client.js";
import { loadConfig } from "./config.js";
import { registerAlephTools } from "./mcp/registerTools.js";
import { readPackageVersion } from "./version.js";

async function main(): Promise<void> {
  const version = readPackageVersion();
  const config = loadConfig(process.env, version);
  const server = new McpServer(
    {
      name: "barracuda-mcp",
      version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const client = new AlephClient(config);
  registerAlephTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
