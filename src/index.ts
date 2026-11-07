import { fileURLToPath } from "node:url";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const server = buildServer();
  // Serve skills/flipp-deals over the Skills extension (falls back to plain
  // tools when the client doesn't implement it). Invalid skills warn, not crash.
  const skills = await loadSkills(fileURLToPath(new URL("../skills", import.meta.url)));
  skills.attach(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-connect when run directly, not when imported by tests.
const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
