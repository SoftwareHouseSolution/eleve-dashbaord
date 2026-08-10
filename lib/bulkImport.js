/**
 * Shared helpers for the bulk import tab (browser) and the bulk publish
 * route (server). Pure functions only — no fetch, no Shopify, no React — so
 * both sides classify and build payloads the same way.
 */

import { buildDefaultDescription, buildDefaultSpec, mergeToBodyHtml } from './fn6Spec';
import { shopifyBinaryInventoryPayload } from './fn6ItemFields';
import { resolveFn6Price } from './fn6Price';
import { getItemImageUrls } from './mediaUrl';

/**
 * Items per request. Shopify's REST bucket refills at 2 calls/sec and each
 * item costs ~3 calls, so 20 items is roughly 30s of work — comfortably
 * inside a serverless invocation while still amortising the round trip.
 */
export const BULK_CHUNK_SIZE = 20;

/** Sanity ceiling on one run, so a bad paste can't queue a million codes. */
export const MAX_BULK_CODES = 5000;

/** Rough seconds per item, used only for the "time left" estimate in the UI. */
export const SECONDS_PER_ITEM = 1.5;

export const IMPORT_STATUS = {
  READY: 'ready',
  LISTED: 'listed',
  NO_PRICE: 'no-price',
  INVALID: 'invalid',
};

/**
 * Pull item codes out of whatever the user pasted — an Excel column, a
 * comma list, a JSON-ish blob. Order is preserved and duplicates dropped so
 * a double-pasted code can't create two products.
 */
export function parsePastedCodes(text) {
  if (!text) return [];
  const seen = new Set();
  const codes = [];
  for (const raw of String(text).split(/[\s,;]+/)) {
    const code = raw.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

/**
 * What would happen to this item if we published it now.
 *
 * `listedSkus` is a Set of SKUs already on Shopify. Missing photos is a
 * warning, not a block — the item still publishes and gets flagged in the
 * report so it can be fixed afterwards.
 */
export function classifyItem(item, listedSkus, rates) {
  const code = String(item?.mco ?? '').trim();
  if (!code) {
    return { code: '', status: IMPORT_STATUS.INVALID, reason: 'Item has no code', photos: 0, warnings: [] };
  }
  if (listedSkus?.has(code)) {
    return { code, status: IMPORT_STATUS.LISTED, reason: 'Already on Shopify', photos: 0, warnings: [] };
  }

  const price = resolveFn6Price(item, rates);
  const photos = getItemImageUrls(item).length;

  if (!Number.isFinite(price) || price <= 0) {
    return {
      code,
      status: IMPORT_STATUS.NO_PRICE,
      reason: 'GWEB has no valid price',
      photos,
      warnings: [],
    };
  }

  return {
    code,
    status: IMPORT_STATUS.READY,
    reason: '',
    price,
    photos,
    warnings: photos === 0 ? ['No photos'] : [],
  };
}

export function isSelectable(classification) {
  return classification?.status === IMPORT_STATUS.READY;
}

/**
 * Build the publish body for one GWEB item.
 *
 * Mirrors what ShopifyPublishForm sends for a single item: title, spec and
 * photos come from GWEB, price comes from resolveFn6Price (GWEB's number —
 * never recomputed here), inventory is the binary in-stock flag.
 *
 * `defaults` is the optional shared-settings panel; every field is optional
 * and an empty one falls back to the same default the single form uses.
 */
export function buildBulkPublishBody(item, rates, defaults = {}) {
  const price = resolveFn6Price(item, rates);
  const imageUrls = getItemImageUrls(item);
  const tags = Array.isArray(defaults.tags) ? defaults.tags.join(', ') : (defaults.tags || '');

  return {
    title: item?.idis?.trim() || `Gold Item ${item?.mco}`,
    body_html: mergeToBodyHtml(buildDefaultDescription(item), buildDefaultSpec(item)),
    product_type: defaults.productType || 'Gold Jewelry',
    price: price == null ? '' : String(price),
    sku: String(item?.mco ?? ''),
    images: imageUrls.map(src => ({ src })),
    vendor: defaults.vendor || 'Eleve',
    tags,
    collectionIds: (defaults.collectionIds || []).map(Number).filter(Boolean),
    ...shopifyBinaryInventoryPayload(true),
  };
}

export function chunk(items, size = BULK_CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** "about 12 min left" / "about 40 sec left" */
export function formatEta(remainingItems) {
  const seconds = Math.max(0, Math.round(remainingItems * SECONDS_PER_ITEM));
  if (seconds < 90) return `about ${seconds} sec left`;
  return `about ${Math.round(seconds / 60)} min left`;
}

/** Roll a flat result list into the counts the report header shows. */
export function summariseResults(results) {
  const summary = { published: 0, skipped: 0, failed: 0, noPhotos: 0 };
  for (const r of results || []) {
    if (r.outcome === 'published') summary.published += 1;
    else if (r.outcome === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
    if ((r.warnings || []).some(w => /photo/i.test(w))) summary.noPhotos += 1;
  }
  return summary;
}
