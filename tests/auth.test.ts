import { describe, expect, it } from "vitest";
import {
  checkPassword,
  createVerifier,
  deriveClientSecret,
  exchangeToken,
  isRedirectUriAllowed,
  issueCode,
  sha256B64url,
} from "../src/auth.js";

const PW = "test-password-123";
const RES = "https://example.workers.dev/mcp";
const CID = "client-1";
const RURI = "https://chatgpt.com/connector/callback";

async function freshCode(chal = "chal-ok") {
  return issueCode({ cid: CID, ruri: RURI, chal, res: RES }, PW);
}

describe("password + redirect validation", () => {
  it("accepts the right password only", async () => {
    await expect(checkPassword(PW, PW)).resolves.toBe(true);
    await expect(checkPassword("nope", PW)).resolves.toBe(false);
  });
  it("allows https and localhost http only", () => {
    expect(isRedirectUriAllowed("https://chatgpt.com/cb")).toBe(true);
    expect(isRedirectUriAllowed("http://evil.com/cb")).toBe(false);
    expect(isRedirectUriAllowed("http://localhost:3000/cb")).toBe(true);
    expect(isRedirectUriAllowed("not-a-url")).toBe(false);
  });
});

describe("code/token exchange (PKCE)", () => {
  it("issues a pair for a valid exchange", async () => {
    const verifier = "correct-verifier";
    const code = await freshCode(await sha256B64url(verifier));
    const r = await exchangeToken(
      { grant_type: "authorization_code", code, redirect_uri: RURI, client_id: CID, code_verifier: verifier },
      PW,
      RES,
    );
    expect(r.status).toBe(200);
    expect(r.body["token_type"]).toBe("Bearer");
  });

  it("rejects wrong verifier, redirect, and tampered code", async () => {
    const code = await freshCode(await sha256B64url("right"));
    const base = { grant_type: "authorization_code", code, client_id: CID };
    await expect(
      exchangeToken({ ...base, redirect_uri: RURI, code_verifier: "wrong" }, PW, RES),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      exchangeToken({ ...base, redirect_uri: "https://evil.com/x", code_verifier: "right" }, PW, RES),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      exchangeToken({ ...base, code: code.slice(0, -2) + "xx", redirect_uri: RURI, code_verifier: "right" }, PW, RES),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("refresh flow works and rejects access tokens", async () => {
    const verifier = "v1";
    const code = await freshCode(await sha256B64url(verifier));
    const first = await exchangeToken(
      { grant_type: "authorization_code", code, redirect_uri: RURI, client_id: CID, code_verifier: verifier },
      PW,
      RES,
    );
    const rt = first.body["refresh_token"] as string;
    const second = await exchangeToken({ grant_type: "refresh_token", refresh_token: rt }, PW, RES);
    expect(second.status).toBe(200);
    const bad = await exchangeToken(
      { grant_type: "refresh_token", refresh_token: first.body["access_token"] as string },
      PW,
      RES,
    );
    expect(bad.status).toBe(400);
  });
});

describe("resource gate verifier", () => {
  it("accepts our access tokens, rejects others", async () => {
    const verifier = "v2";
    const code = await freshCode(await sha256B64url(verifier));
    const pair = await exchangeToken(
      { grant_type: "authorization_code", code, redirect_uri: RURI, client_id: CID, code_verifier: verifier },
      PW,
      RES,
    );
    const gate = createVerifier(PW, RES);
    const info = await gate.verifyAccessToken(pair.body["access_token"] as string);
    expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);
    await expect(gate.verifyAccessToken(pair.body["refresh_token"] as string)).rejects.toThrow();
    await expect(gate.verifyAccessToken("garbage")).rejects.toThrow();
  });

  it("DCR secret verifies by recomputation", async () => {
    const secret = await deriveClientSecret(CID, PW);
    await expect(checkPassword(secret, await deriveClientSecret(CID, PW))).resolves.toBe(true);
    await expect(checkPassword("wrong", await deriveClientSecret(CID, PW))).resolves.toBe(false);
  });
});
