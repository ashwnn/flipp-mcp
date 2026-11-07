import { createMcpHandler, getOAuthProtectedResourceMetadataUrl, requireBearerAuth } from "@modelcontextprotocol/server";
import { SkillsExtension, memorySkillFiles } from "@modelcontextprotocol/server/ext/skills";
import { createVerifier, handleAuthRequest, type Env } from "./auth.js";
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;
    const expectedResource = `${origin}/mcp`;

    // Public OAuth 2.1 endpoints (discovery, registration, login, token).
    const authResponse = await handleAuthRequest(request, env);
    if (authResponse) return authResponse;

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("flipp-mcp: POST MCP Streamable HTTP requests to /mcp", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });

    const password = env.FLIPP_MCP_PASSWORD;
    if (!password) {
      return Response.json(
        { error: "server_misconfigured", error_description: "Set the FLIPP_MCP_PASSWORD secret, then reconnect." },
        { status: 401 },
      );
    }

    // Spec-compliant resource-server gate: Bearer token, 401 + WWW-Authenticate challenge otherwise.
    const gate = requireBearerAuth({
      verifier: createVerifier(password),
      requiredScopes: [],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(expectedResource)),
      expectedResource: new URL(expectedResource),
    });
    const auth = await gate(request);
    if (auth instanceof Response) return auth;
    return handler.fetch(request, { authInfo: auth });
  },
};
