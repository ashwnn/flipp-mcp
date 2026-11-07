import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";

// Single-password OAuth 2.1 authorization server + resource metadata.
// Stateless: codes/tokens are HMAC-signed, no KV/storage needed.
// Runtime-agnostic (WebCrypto only) — runs in Workers, Node, Vitest.

export interface Env {
  FLIPP_MCP_PASSWORD?: string | undefined;
}

const CODE_TTL = 5 * 60; // 5 min
const ACCESS_TTL = 60 * 60; // 1 h
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 d

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Fresh ArrayBuffer-backed bytes (satisfies DOM BufferSource typing). */
function utf8(s: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(s);
  const out = new Uint8Array(enc.byteLength);
  out.set(enc);
  return out;
}

async function hmacKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8(`flipp-mcp-v1:${password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacHex(password: string, message: string): Promise<string> {
  const key = await hmacKey(password);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface TokenPayload {
  typ: "code" | "access" | "refresh";
  cid: string;
  exp: number;
  res?: string | undefined;
  ruri?: string | undefined;
  chal?: string | undefined;
}

async function signToken(payload: TokenPayload, password: string): Promise<string> {
  const key = await hmacKey(password);
  const body = b64urlEncode(utf8(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", key, utf8(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

async function readToken(token: string, password: string): Promise<TokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Malformed token");
  }
  const key = await hmacKey(password);
  const body = utf8(parts[0]);
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = b64urlDecode(parts[1]);
  } catch {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Malformed token signature");
  }
  const ok = await crypto.subtle.verify("HMAC", key, sig, body);
  if (!ok) throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid token signature");
  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0]))) as TokenPayload;
  } catch {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Malformed token payload");
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Token has expired");
  }
  return payload;
}

export async function sha256B64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(input));
  return b64urlEncode(new Uint8Array(digest));
}

/** Constant-time password check (hash both sides, compare digests). */
export async function checkPassword(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", utf8(provided)),
    crypto.subtle.digest("SHA-256", utf8(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export function isRedirectUriAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return (
    u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")
  );
}

export function deriveClientSecret(clientId: string, password: string): Promise<string> {
  return hmacHex(password, `client:${clientId}`);
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export async function issueCode(
  args: { cid: string; ruri: string; chal: string; res: string },
  password: string,
): Promise<string> {
  return signToken(
    { typ: "code", cid: args.cid, ruri: args.ruri, chal: args.chal, res: args.res, exp: now() + CODE_TTL },
    password,
  );
}

export async function issueTokenPair(
  args: { cid: string; res: string },
  password: string,
): Promise<{ access_token: string; refresh_token: string; token_type: string; expires_in: number }> {
  const [access_token, refresh_token] = await Promise.all([
    signToken({ typ: "access", cid: args.cid, res: args.res, exp: now() + ACCESS_TTL }, password),
    signToken({ typ: "refresh", cid: args.cid, res: args.res, exp: now() + REFRESH_TTL }, password),
  ]);
  return { access_token, refresh_token, token_type: "Bearer", expires_in: ACCESS_TTL };
}

/** Resource-server verifier for the SDK gate: accepts our access tokens only. */
export function createVerifier(password: string) {
  return {
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      const p = await readToken(token, password);
      if (p.typ !== "access") throw new OAuthError(OAuthErrorCode.InvalidToken, "Not an access token");
      const info: AuthInfo = { token, clientId: p.cid, scopes: [], expiresAt: p.exp };
      if (p.res) info.resource = new URL(p.res);
      return info;
    },
  };
}

/** Exchange an auth code (PKCE-verified) or refresh token for a token pair. */
export async function exchangeToken(
  params: Record<string, string>,
  password: string,
  expectedResource: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const grant = params["grant_type"];
  const checkClientSecret = async (cid: string): Promise<boolean> => {
    const secret = params["client_secret"];
    if (!secret) return true; // public client
    return checkPassword(secret, await deriveClientSecret(cid, password));
  };

  if (grant === "authorization_code") {
    const { code, redirect_uri: ruri, client_id: cid, code_verifier: verifier } = params;
    if (!code || !ruri || !cid || !verifier) {
      return { status: 400, body: { error: "invalid_request", error_description: "Missing code/token parameters" } };
    }
    let p: TokenPayload;
    try {
      p = await readToken(code, password);
    } catch {
      return { status: 400, body: { error: "invalid_grant", error_description: "Invalid authorization code" } };
    }
    if (p.typ !== "code" || p.cid !== cid || p.ruri !== ruri || !p.chal) {
      return { status: 400, body: { error: "invalid_grant", error_description: "Code mismatch" } };
    }
    if (p.res !== expectedResource) {
      return { status: 400, body: { error: "invalid_target", error_description: "Resource mismatch" } };
    }
    if ((await sha256B64url(verifier)) !== p.chal) {
      return { status: 400, body: { error: "invalid_grant", error_description: "PKCE verification failed" } };
    }
    if (!(await checkClientSecret(cid))) {
      return { status: 401, body: { error: "invalid_client", error_description: "Bad client secret" } };
    }
    return { status: 200, body: await issueTokenPair({ cid, res: p.res ?? expectedResource }, password) };
  }

  if (grant === "refresh_token") {
    const { refresh_token: rt, client_id: cid } = params;
    if (!rt) return { status: 400, body: { error: "invalid_request", error_description: "Missing refresh token" } };
    let p: TokenPayload;
    try {
      p = await readToken(rt, password);
    } catch {
      return { status: 400, body: { error: "invalid_grant", error_description: "Invalid refresh token" } };
    }
    if (p.typ !== "refresh" || (cid && p.cid !== cid)) {
      return { status: 400, body: { error: "invalid_grant", error_description: "Refresh token mismatch" } };
    }
    if (!(await checkClientSecret(p.cid))) {
      return { status: 401, body: { error: "invalid_client", error_description: "Bad client secret" } };
    }
    return { status: 200, body: await issueTokenPair({ cid: p.cid, res: p.res ?? expectedResource }, password) };
  }

  return {
    status: 400,
    body: { error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token" },
  };
}

export function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
  };
}

function authorizeForm(action: string, fields: Record<string, string>, error?: string): string {
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, "&quot;")}">`)
    .join("\n");
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:28rem;margin:4rem auto">
<h1>flipp-mcp</h1><p>Enter the server password to connect.</p>
${error ? `<p style="color:red">${error}</p>` : ""}
<form method="post" action="${action}">${hidden}
<input type="password" name="password" autocomplete="current-password" autofocus style="width:100%;padding:.5rem">
<button type="submit" style="margin-top:.5rem;padding:.5rem 1rem">Connect</button></form></body></html>`;
}

/** Handles public OAuth routes. Returns null when the path isn't an auth route. */
export async function handleAuthRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = url.origin;
  const expectedResource = `${origin}/mcp`;

  if (
    (url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp") &&
    request.method === "GET"
  ) {
    return Response.json(protectedResourceMetadata(origin));
  }
  if (url.pathname === "/.well-known/oauth-authorization-server" && request.method === "GET") {
    return Response.json(authorizationServerMetadata(origin));
  }

  if (url.pathname === "/register" && request.method === "POST") {
    let body: { redirect_uris?: unknown; client_name?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid_client_metadata" }, { status: 400 });
    }
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (redirectUris.length === 0 || !redirectUris.every(isRedirectUriAllowed)) {
      return Response.json({ error: "invalid_redirect_uri" }, { status: 400 });
    }
    const clientId = crypto.randomUUID();
    const password = env.FLIPP_MCP_PASSWORD ?? "";
    return Response.json(
      {
        client_id: clientId,
        client_secret: await deriveClientSecret(clientId, password),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      { status: 201 },
    );
  }

  if (url.pathname === "/authorize" && (request.method === "GET" || request.method === "POST")) {
    const p: Record<string, string> = Object.fromEntries(url.searchParams.entries());
    if (request.method === "POST") {
      // Clients may post OAuth params in the body, the query, or both.
      const fd = await request.formData();
      for (const k of ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource", "password"]) {
        const v = fd.get(k);
        if (typeof v === "string" && v) p[k] = v;
      }
    }
    const passwordField = p["password"] ?? "";
    const cid = p["client_id"] ?? "";
    const ruri = p["redirect_uri"] ?? "";
    const chal = p["code_challenge"] ?? "";
    const method = p["code_challenge_method"] ?? "";
    const state = p["state"] ?? "";
    const resource = p["resource"] ?? expectedResource;
    const valid =
      p["response_type"] === "code" && cid && isRedirectUriAllowed(ruri) && chal && method === "S256" && resource === expectedResource;
    if (!valid) {
      return new Response("Invalid authorization request (need response_type=code, redirect_uri, code_challenge S256).", {
        status: 400,
      });
    }
    if (request.method === "GET" || !passwordField) {
      return new Response(authorizeForm(url.pathname + url.search, { client_id: cid }), {
        headers: { "content-type": "text/html" },
      });
    }
    const password = env.FLIPP_MCP_PASSWORD;
    if (!password || !(await checkPassword(passwordField, password))) {
      return new Response(authorizeForm(url.pathname + url.search, { client_id: cid }, "Wrong password."), {
        status: 401,
        headers: { "content-type": "text/html" },
      });
    }
    const code = await issueCode({ cid, ruri, chal, res: expectedResource }, password);
    const dest = new URL(ruri);
    dest.searchParams.set("code", code);
    if (state) dest.searchParams.set("state", state);
    return Response.redirect(dest.toString(), 302);
  }

  if (url.pathname === "/token" && request.method === "POST") {
    const ctype = request.headers.get("content-type") ?? "";
    let params: Record<string, string> = {};
    if (ctype.includes("application/json")) {
      const j = (await request.json()) as Record<string, unknown>;
      params = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, typeof v === "string" ? v : ""]));
    } else {
      const fd = await request.formData();
      const get = (k: string): string => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
      params = {
        grant_type: get("grant_type"),
        code: get("code"),
        redirect_uri: get("redirect_uri"),
        client_id: get("client_id"),
        client_secret: get("client_secret"),
        code_verifier: get("code_verifier"),
        refresh_token: get("refresh_token"),
        resource: get("resource"),
      };
      // Basic auth (client_secret_basic)
      const basic = request.headers.get("authorization");
      if (basic?.toLowerCase().startsWith("basic ")) {
        try {
          const [cid, secret] = atob(basic.slice(6)).split(":");
          if (cid) params["client_id"] = cid;
          if (secret !== undefined) params["client_secret"] = secret;
        } catch {
          return Response.json({ error: "invalid_client" }, { status: 401 });
        }
      }
    }
    const password = env.FLIPP_MCP_PASSWORD ?? "";
    const { status, body } = await exchangeToken(params, password, expectedResource);
    return Response.json(body, { status });
  }

  return null;
}
