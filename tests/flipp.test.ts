import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchJson, normalizeLocale, normalizePostalCode } from "../src/lib/http.js";
import { getFlyerItems, listFlyers, searchItems } from "../src/lib/flipp.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postal + locale validation", () => {
  it("normalizes CA with space and US zip", () => {
    expect(normalizePostalCode("m5v 2t6")).toBe("M5V2T6");
    expect(normalizePostalCode("10001")).toBe("10001");
  });
  it("rejects bad codes", () => {
    expect(() => normalizePostalCode("M5V")).toThrow(/Invalid postal_code/);
    expect(() => normalizePostalCode("ABC")).toThrow();
  });
  it("locale defaults to en, rejects others", () => {
    expect(normalizeLocale(undefined)).toBe("en");
    expect(normalizeLocale("fr-CA")).toBe("fr");
    expect(() => normalizeLocale("de")).toThrow();
  });
});

describe("fetchJson retry", () => {
  it("retries 500 then succeeds", async () => {
    const ok = new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("x", { status: 500 }))
        .mockResolvedValueOnce(ok),
    );
    await expect(fetchJson("https://example.com", { retries: 1, timeoutMs: 2000 })).resolves.toEqual({ ok: 1 });
  });
  it("does not retry 404", async () => {
    const f = vi.fn().mockResolvedValue(new Response("no", { status: 404 }));
    vi.stubGlobal("fetch", f);
    await expect(fetchJson("https://example.com")).rejects.toThrow(/404/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("flipp lib (mocked)", () => {
  it("searchItems slices to limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [{ flyer_item_id: 1, name: "a" }, { flyer_item_id: 2, name: "b" }] }), {
          status: 200,
        }),
      ),
    );
    const r = await searchItems({ query: "milk", postal_code: "M5V2T6", limit: 1 });
    expect(r["total"]).toBe(2);
    expect((r["items"] as unknown[]).length).toBe(1);
  });

  it("listFlyers filters by merchant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ flyers: [{ id: 1, merchant: "Walmart" }, { id: 2, merchant: "Loblaws" }] }),
          { status: 200 },
        ),
      ),
    );
    const r = await listFlyers({ postal_code: "M5V2T6", merchant: "walmart", limit: 10 });
    expect(r["filtered"]).toBe(1);
  });

  it("getFlyerItems filters by query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: 1, name: "Whole Milk" }, { id: 2, name: "Bread" }]), { status: 200 }),
      ),
    );
    const r = await getFlyerItems({ flyer_id: 5, postal_code: "M5V2T6", query: "milk", limit: 10 });
    expect(r["filtered"]).toBe(1);
  });

  it("searchItems surfaces DAM 404 without fallback", async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"error":"404"}', { status: 404 }));
    vi.stubGlobal("fetch", f);
    await expect(searchItems({ query: "milk", postal_code: "M5V2T6" })).rejects.toThrow(/404/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
