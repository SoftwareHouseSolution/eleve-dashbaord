import { getPublicApiBaseUrl } from './publicEnv';
import { getShopifyToken } from './shopify';
import { findShopifyProduct } from './shopifyProductLookup';
import { fetchFn6ByMco } from './fn6Server';
import { resolveFn6Price, goldPriceForKarat } from './fn6Price';
import {
  formatGwebWeightDisplay,
  upsertVariantGwebWeightMetafield,
  upsertVariantGwebPrcMetafield,
  upsertVariantGwebPrcusMetafield,
  upsertVariantGwebPr18UsedMetafield,
} from './gwebWeightMetafield';

const DEFAULT_THROTTLE_MS = 5000;
const throttleMap = new Map();

function getThrottleMs() {
  const raw = process.env.SHOPIFY_REFRESH_PRICE_THROTTLE_MS;
  const n = raw != null && raw !== '' ? Number(raw) : DEFAULT_THROTTLE_MS;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_THROTTLE_MS;
}

function isThrottledPut(sku, suffix = '') {
  const key = suffix ? `${sku}:${suffix}` : sku;
  const lastPut = throttleMap.get(key);
  return lastPut != null && Date.now() - lastPut < getThrottleMs();
}

function markPut(sku, suffix = '') {
  const key = suffix ? `${sku}:${suffix}` : sku;
  throttleMap.set(key, Date.now());
}

export async function putShopifyVariantPrice(domain, token, variantId, priceStr) {
  const res = await fetch(
    `https://${domain}/admin/api/2024-10/variants/${variantId}.json`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({
        variant: {
          id: Number(variantId),
          price: priceStr,
        },
      }),
    },
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = typeof data.errors === 'object'
      ? JSON.stringify(data.errors)
      : (data.errors || 'Shopify API error');
    throw new Error(errMsg);
  }
}

/**
 * Fetch GWEB FN6 by MCO/SKU; sync Shopify variant price and custom.gweb_weight metafield.
 *
 * `force` bypasses the write throttle and turns a gold-rate fetch failure
 * into a thrown error instead of a silent no-op. The throttle exists to
 * protect the bulk catalog sweep from Shopify's rate limit; it must never
 * gate a just-in-time refresh for the 1-3 SKUs an actual customer is
 * checking out with — a caller (add-to-cart / checkout intercept) that
 * gets back `updated: false` there would otherwise let payment proceed on
 * a stale price. Pass `force: true` from any customer-facing price sync.
 *
 * @param {string} sku
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ found: boolean, price?: string, currency?: string, updated?: boolean, weight?: string|null }>}
 */
export async function refreshVariantPrice(sku, { force = false } = {}) {
  const { item, normalizedSku } = await fetchFn6ByMco(sku);
  if (!item) {
    return { found: false };
  }

  const rawWeight = item?.go_cr;
  const weightStr = rawWeight != null && rawWeight !== ''
    ? `${Number(rawWeight).toFixed(3)} g`
    : null;

  const { token, domain } = await getShopifyToken();
  const shopify = await findShopifyProduct(domain, token, { sku: normalizedSku });

  if (!shopify.found || !shopify.variantId) {
    return { found: false };
  }

  // Fetch the gold rate so the per-karat rate can be recorded alongside the
  // price. A JIT/checkout call must not silently proceed without one —
  // better to fail the add-to-cart than let it through on an unverified price.
  const base = getPublicApiBaseUrl();
  let rates = null;
  try {
    const rateRes = await fetch(`${base}/Sup/api/gold-rate/`, { cache: 'no-store' });
    if (!rateRes.ok) {
      throw new Error(`gold-rate fetch failed: ${rateRes.status}`);
    }
    rates = await rateRes.json();
  } catch (err) {
    if (force) throw err;
    rates = null;
  }

  let priceStr = null;
  let priceUpdated = false;

  // GWEB's price, at the item's own karat — the same number the bulk sync
  // writes, so a single-SKU refresh can never disagree with a full sweep.
  const rounded = resolveFn6Price(item, rates);
  const goldUsed = goldPriceForKarat(rates, item?.co);

  if (rounded != null && rounded > 0) {
    priceStr = String(rounded);
    if (force || !isThrottledPut(normalizedSku, 'price')) {
      await putShopifyVariantPrice(domain, token, shopify.variantId, priceStr);
      markPut(normalizedSku, 'price');
      priceUpdated = true;
      // Written atomically with the price so the recorded rate can
      // never disagree with what the price was actually computed from.
      try {
        await upsertVariantGwebPr18UsedMetafield(domain, token, shopify.variantId, goldUsed);
      } catch { /* non-fatal — price already landed */ }
    }
  } else if (force) {
    throw new Error('no usable price for this item — refusing to confirm');
  }

  if (force && !priceUpdated) {
    throw new Error(`price sync failed for ${normalizedSku} — could not confirm Shopify was updated`);
  }

  // Always write the gweb_* metafields so the theme can compute prices locally.
  // Failures are non-fatal — the response is still returned.
  const metafieldErrors = [];
  if (weightStr) {
    try {
      const w = formatGwebWeightDisplay(item?.go_cr);
      if (w) await upsertVariantGwebWeightMetafield(domain, token, shopify.variantId, w);
    } catch (e) {
      metafieldErrors.push({ key: 'gweb_weight', message: e.message });
    }
  }
  const prcRaw = item?.prc;
  if (prcRaw != null && prcRaw !== '' && Number(prcRaw) !== 0) {
    try {
      await upsertVariantGwebPrcMetafield(domain, token, shopify.variantId, prcRaw);
    } catch (e) {
      metafieldErrors.push({ key: 'gweb_prc', message: e.message });
    }
  }
  const prcusRaw = item?.prcus;
  if (prcusRaw != null && prcusRaw !== '' && Number(prcusRaw) !== 0) {
    try {
      await upsertVariantGwebPrcusMetafield(domain, token, shopify.variantId, prcusRaw);
    } catch (e) {
      metafieldErrors.push({ key: 'gweb_prcus', message: e.message });
    }
  }

  return {
    found: true,
    ...(priceStr != null ? { price: priceStr, currency: 'EGP', updated: priceUpdated } : {}),
    ...(weightStr != null ? { weight: weightStr } : {}),
    ...(metafieldErrors.length > 0 ? { metafieldErrors } : {}),
  };
}
