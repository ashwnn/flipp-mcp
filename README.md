# flipp-mcp

Unofficial [MCP](https://modelcontextprotocol.io/) server for [Flipp](https://flipp.com/flyers) flyers and deals — grocery and retail sale prices, no API key required. Flyers are location-specific, so every flyer/item call takes a postal code.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ashwnn/flipp-mcp)

Run it locally over stdio, or deploy it to Cloudflare Workers as a remote MCP server (stateless Streamable HTTP). Ships a `flipp-deals` [Agent Skill](https://modelcontextprotocol.io/extensions/skills/overview) so Claude and ChatGPT learn the deal-hunting workflow straight from the server.

## Tools

| Tool | What it does |
|---|---|
| `search_items` | Search deals by keyword near a postal code |
| `get_item` | Full detail for one item (price, sale story, dates, image) |
| `list_flyers` | Flyers near a postal code, optional `merchant` filter |
| `get_flyer_items` | Items in one flyer, optional `query` filter |
| `list_merchants` | Retailers Flipp tracks, optional `query` filter |
| `get_nearby_stores` | Physical stores carrying a given flyer |

Postal codes: Canada `A1A1A1` (e.g. `M5V2T6`), US 5-digit ZIP (e.g. `10001`). `locale` is `en` (default) or `fr`. `limit` is 1–50.

## Quickstart (local)

```bash
npm install
npm run build
node dist/index.js        # stdio
```

Claude Desktop / Claude Code (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flipp": {
      "command": "node",
      "args": ["<path-to>/flipp-mcp/dist/index.js"]
    }
  }
}
```

## Remote (Cloudflare Workers)

One click (forks the repo to your account and wires up builds):

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ashwnn/flipp-mcp)

Or manually:

```bash
npx wrangler login
npm run deploy      # -> https://flipp-mcp.<your-subdomain>.workers.dev/mcp
```

Point any Streamable-HTTP MCP client at `https://<your-worker>.workers.dev/mcp`.

## Skill

`skills/flipp-deals/SKILL.md` teaches agents the workflow: ask for a postal code, search then drill down, always quote flyer expiry dates. Served live over the Skills extension (`skills/list` + `skills/get` on `skill://flipp-deals/SKILL.md`); ChatGPT can also import it at plugin submission, or copy `skills/flipp-deals/` into your agent's skills folder.

## How it works

Uses the same JSON backends as the Flipp web app:

- Primary: `https://dam.flippenterprise.net/api/flipp`
- Fallback: `https://backflipp.wishabi.com/flipp` (search + item detail)

10s upstream timeout, 2 retries on 429/5xx, random 16-digit `sid` per call (required by Flipp).

## Dev

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (mocked, offline)
```

## Disclaimer

Unofficial project, not affiliated with Flipp/Wishabi. Uses undocumented endpoints that may change without notice. Be gentle — cache flyer lists per postal code instead of re-querying.
