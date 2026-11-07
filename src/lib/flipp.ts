import {
  BACKFLIPP_BASE,
  DAM_BASE,
  UpstreamError,
  fetchJson,
  makeSid,
  normalizeLocale,
  normalizePostalCode,
} from "./http.js";

export interface SearchItemsArgs {
  query: string;
  postal_code: string;
  locale?: string | undefined;
  limit?: number | undefined;
}

export interface ItemArgs {
  item_id: number;
  locale?: string | undefined;
}

export interface ListFlyersArgs {
  postal_code: string;
  locale?: string | undefined;
  merchant?: string | undefined;
  limit?: number | undefined;
}

export interface FlyerItemsArgs {
  flyer_id: number;
  postal_code: string;
  locale?: string | undefined;
  query?: string | undefined;
  limit?: number | undefined;
}

export interface NearbyStoresArgs {
  flyer_id: number;
  postal_code: string;
  locale?: string;
}

function clampLimit(limit: number | undefined, def = 20): number {
  if (limit === undefined) return def;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error(`Invalid limit "${limit}". Use an integer 1..50.`);
  }
  return limit;
}

function pick<T>(v: unknown, path: string[]): T | undefined {
  let cur: unknown = v;
  for (const k of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur as T | undefined;
}

// DAM search returns {items:[{flyer_item_id,...}]}, backflipp returns {items:[...]} — normalize to shared shape.
export function normalizeSearchItem(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: raw["flyer_item_id"] ?? raw["id"],
    flyer_id: raw["flyer_id"],
    name: raw["name"],
    price: raw["current_price"] ?? raw["price"] ?? null,
    original_price: raw["original_price"] ?? null,
    merchant: raw["merchant_name"] ?? raw["merchant"] ?? null,
    merchant_id: raw["merchant_id"] ?? null,
    valid_from: raw["valid_from"] ?? null,
    valid_to: raw["valid_to"] ?? null,
    image: raw["clipping_image_url"] ?? raw["clean_image_url"] ?? raw["cutout_image_url"] ?? null,
  };
}

export async function searchItems(a: SearchItemsArgs): Promise<Record<string, unknown>> {
  const q = a.query.trim();
  if (!q) throw new Error('Invalid query: must be a non-empty string.');
  const postal_code = normalizePostalCode(a.postal_code);
  const locale = normalizeLocale(a.locale);
  const limit = clampLimit(a.limit);
  const sid = makeSid();
  const damUrl =
    `${DAM_BASE}/flyer_items/search?locale=${locale}` +
    `&postal_code=${encodeURIComponent(postal_code)}&q=${encodeURIComponent(q)}&sid=${sid}`;
  try {
    const data = await fetchJson(damUrl);
    const items = (pick<unknown[]>(data, ["items"]) ?? []).slice(0, limit).map((i) =>
      normalizeSearchItem(i as Record<string, unknown>),
    );
    return { total: (pick<unknown[]>(data, ["items"]) ?? []).length, items, backend: "dam" };
  } catch (e) {
    // Only fall back on retryable/network errors; surface 4xx (bad id/query) directly.
    if (e instanceof UpstreamError && e.status !== undefined && e.status < 500 && e.status !== 429) throw e;
    const fbUrl =
      `${BACKFLIPP_BASE}/items/search?q=${encodeURIComponent(q)}` +
      `&postal_code=${encodeURIComponent(postal_code)}`;
    const data = await fetchJson(fbUrl);
    const all = pick<unknown[]>(data, ["items"]) ?? [];
    return {
      total: all.length,
      items: all.slice(0, limit).map((i) => normalizeSearchItem(i as Record<string, unknown>)),
      backend: "backflipp-fallback",
    };
  }
}

export async function getItem(a: ItemArgs): Promise<Record<string, unknown>> {
  if (!Number.isInteger(a.item_id) || a.item_id <= 0) throw new Error(`Invalid item_id "${a.item_id}".`);
  const locale = normalizeLocale(a.locale);
  const sid = makeSid();
  try {
    const data = await fetchJson(`${DAM_BASE}/flyer_items/${a.item_id}?locale=${locale}&sid=${sid}`);
    return { item: data, backend: "dam" };
  } catch (e) {
    if (e instanceof UpstreamError && e.status !== undefined && e.status < 500 && e.status !== 429) throw e;
    const data = await fetchJson(`${BACKFLIPP_BASE}/items/${a.item_id}`);
    return { item: (data as Record<string, unknown>)["item"] ?? data, backend: "backflipp-fallback" };
  }
}

export function normalizeFlyer(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: raw["id"],
    name: raw["name"],
    merchant: raw["merchant"],
    merchant_id: raw["merchant_id"],
    valid_from: raw["valid_from"],
    valid_to: raw["valid_to"],
    categories: raw["categories"] ?? [],
    thumbnail: raw["thumbnail_url"] ?? raw["mobile_thumbnail_url"] ?? null,
  };
}

export async function listFlyers(a: ListFlyersArgs): Promise<Record<string, unknown>> {
  const postal_code = normalizePostalCode(a.postal_code);
  const locale = normalizeLocale(a.locale);
  const limit = clampLimit(a.limit);
  const sid = makeSid();
  const data = await fetchJson(
    `${DAM_BASE}/data?locale=${locale}&postal_code=${encodeURIComponent(postal_code)}&sid=${sid}`,
  );
  let flyers = (pick<unknown[]>(data, ["flyers"]) ?? []).map((f) =>
    normalizeFlyer(f as Record<string, unknown>),
  );
  const total = flyers.length;
  if (a.merchant?.trim()) {
    const m = a.merchant.toLowerCase();
    flyers = flyers.filter((f) => String(f["merchant"] ?? "").toLowerCase().includes(m));
  }
  return { total, filtered: flyers.length, flyers: flyers.slice(0, limit) };
}

export async function getFlyerItems(a: FlyerItemsArgs): Promise<Record<string, unknown>> {
  if (!Number.isInteger(a.flyer_id) || a.flyer_id <= 0) throw new Error(`Invalid flyer_id "${a.flyer_id}".`);
  const postal_code = normalizePostalCode(a.postal_code);
  const locale = normalizeLocale(a.locale);
  const limit = clampLimit(a.limit);
  const sid = makeSid();
  const data = await fetchJson(
    `${DAM_BASE}/flyers/${a.flyer_id}/flyer_items?locale=${locale}` +
      `&postal_code=${encodeURIComponent(postal_code)}&sid=${sid}`,
  );
  const arr = Array.isArray(data) ? data : (pick<unknown[]>(data, ["flyer_items"]) ?? []);
  let items = arr.map((i) => {
    const r = i as Record<string, unknown>;
    return {
      id: r["id"],
      name: r["name"],
      price: r["price"] ?? r["current_price"] ?? null,
      valid_from: r["valid_from"] ?? null,
      valid_to: r["valid_to"] ?? null,
      image: r["cutout_image_url"] ?? null,
    };
  });
  const total = items.length;
  if (a.query?.trim()) {
    const q = a.query.toLowerCase();
    items = items.filter((i) => String(i["name"] ?? "").toLowerCase().includes(q));
  }
  return { flyer_id: a.flyer_id, total, filtered: items.length, items: items.slice(0, limit) };
}

export async function listMerchants(locale?: string, query?: string): Promise<Record<string, unknown>> {
  const l = normalizeLocale(locale);
  const data = await fetchJson(`${DAM_BASE}/merchants?locale=${l}`);
  let merchants = (pick<unknown[]>(data, ["merchants"]) ?? []) as Record<string, unknown>[];
  const total = merchants.length;
  if (query?.trim()) {
    const q = query.toLowerCase();
    merchants = merchants.filter((m) => String(m["name"] ?? "").toLowerCase().includes(q));
  }
  return { total, filtered: merchants.length, merchants: merchants.slice(0, 50) };
}

export async function getNearbyStores(a: NearbyStoresArgs): Promise<Record<string, unknown>> {
  if (!Number.isInteger(a.flyer_id) || a.flyer_id <= 0) throw new Error(`Invalid flyer_id "${a.flyer_id}".`);
  const postal_code = normalizePostalCode(a.postal_code);
  const locale = normalizeLocale(a.locale);
  const sid = makeSid();
  const data = await fetchJson(
    `${DAM_BASE}/flyers/${a.flyer_id}/stores/nearby?postal_code=${encodeURIComponent(postal_code)}&locale=${locale}&sid=${sid}`,
  );
  const stores = (pick<unknown[]>(data, ["stores"]) ?? (Array.isArray(data) ? data : [])) as unknown[];
  return { flyer_id: a.flyer_id, total: stores.length, stores: stores.slice(0, 50) };
}
