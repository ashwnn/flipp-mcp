export const DAM_BASE = "https://dam.flippenterprise.net/api/flipp";
export const BACKFLIPP_BASE = "https://backflipp.wishabi.com/flipp";
export const USER_AGENT = "flipp-mcp/0.1.0 (unofficial; +https://flipp.com/flyers)";

export function makeSid(): string {
  let s = "";
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 10).toString();
  return s;
}

// "M5V 2T6" -> "M5V2T6", "10001-1234" kept, upper-cased. Throws on invalid.
export function normalizePostalCode(input: string): string {
  const code = input.trim().toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(code)) return code;
  if (/^\d{5}(-\d{4})?$/.test(code)) return code;
  throw new Error(
    `Invalid postal_code "${input}". Use CA "A1A1A1" (no space) or US ZIP "10001".`,
  );
}

export function normalizeLocale(input: string | undefined): string {
  const l = (input ?? "en").trim().toLowerCase().split("-")[0];
  if (l === "en" || l === "fr") return l;
  throw new Error(`Invalid locale "${input}". Use "en" or "fr".`);
}

export class UpstreamError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export async function fetchJson(
  url: string,
  opts?: { timeoutMs?: number; retries?: number },
): Promise<unknown> {
  const timeoutMs = opts?.timeoutMs ?? 10000;
  const retries = opts?.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new UpstreamError(`Flipp upstream retryable HTTP ${res.status}`, res.status);
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        throw new UpstreamError(`Flipp upstream HTTP ${res.status}: ${body}`, res.status);
      }
      return (await res.json()) as unknown;
    } catch (e) {
      lastErr = e;
      if (attempt === retries) break;
      if (e instanceof UpstreamError && e.status !== undefined && e.status < 500 && e.status !== 429) break;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
