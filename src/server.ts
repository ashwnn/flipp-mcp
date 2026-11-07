import { McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./tools.js";

export function buildServer(): McpServer {
  const server = new McpServer({ name: "flipp-mcp", version: "0.1.0" });
  registerTools(server);
  return server;
}
