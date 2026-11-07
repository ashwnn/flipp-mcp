---
name: flipp-deals
description: Find grocery and retail sale prices from Flipp flyers. Use when the user asks about deals, discounts, flyer prices, or what's on sale at a store near them.
---

# Flipp deals

Flipp aggregates store flyers. All flyer data is location-specific: every flyer
or item call needs the shopper's postal code.

## Postal codes

- Canada: `A1A1A1` (no space, e.g. `M5V2T6`). US: 5-digit ZIP (e.g. `10001`).
- If the user hasn't given one, ask. Never guess a postal code.

## Workflows

**Find a deal:** `search_items` with `query` + `postal_code` (e.g. chicken, milk,
eggs). Results include price, merchant, and validity dates. Call `get_item`
with an item `id` for full detail (description, sale story, image).

**Browse a flyer:** `list_flyers` with `postal_code`, optionally filtered by
`merchant` (e.g. Walmart, Loblaws, No Frills). Then `get_flyer_items` with the
`flyer_id` and same `postal_code`; narrow with `query` when the user wants
something specific.

**Store coverage:** `list_merchants` (optional `query`) shows which retailers
Flipp tracks. `get_nearby_stores` with a `flyer_id` + `postal_code` lists
physical stores carrying that flyer.

## Rules

- `locale` is `en` (default) or `fr` for French-Canadian flyers.
- `limit` is 1-50, default 20. Prefer small limits, then drill down.
- Prices come with `valid_from`/`valid_to` — always mention dates when quoting
  a deal, since flyers expire (most roll over Wed/Thu).
- Upstream errors return `isError: true` with a message — surface it plainly
  instead of retrying with different casing or punctuation.
