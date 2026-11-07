import { createMcpHandler } from "@modelcontextprotocol/server";
import { SkillsExtension, memorySkillFiles } from "@modelcontextprotocol/server/ext/skills";
import { buildServer } from "./server.js";
import { SKILL_FILES } from "./skills.inline.js";

// Static catalog, loaded once per isolate (no filesystem on Workers).
const skills = await SkillsExtension.load(memorySkillFiles(SKILL_FILES));

// Stateless Streamable HTTP: fresh server per request, single JSON response
// (no SSE streaming — required for edge/serverless runtimes).
const handler = createMcpHandler(
  () => {
    const server = buildServer();
    skills.attach(server);
    return server;
  },
  { responseMode: "json" },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("flipp-mcp: POST MCP Streamable HTTP requests to /mcp", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    return handler.fetch(request);
  },
};
