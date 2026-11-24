import { getShopifyToken } from './shopify';
import { buildSkuVariantMap } from './shopifyBulkPriceSync';
import { gidToNumericId } from './shopifyProductLookup';
import { putShopifyVariantPrice } from './refreshVariantPrice';
import { isDiamondSku, diamondZcoFromSku, resolveDiamondPrice, diamondMetafields } from './diamond';
import { setVariantMetafields, setDiamondAvailability } from './diamondServer';
import { fullScan, getAllDiamonds } from './diamondStock';

/**
 * Keep diamonds already on Shopify in line with GWEB (Dim.Fd2).
 *
 * Data comes from the shared diamond stock (lib/diamondStock.js), so no
 * extra GWEB calls are made here. For each "D-<code>" variant on Shopify:
 *   - variant.price  = GWEB price (totus_dr_r x USD), 2 decimals
 *   - availability   = 0 when GWEB shows the piece sold (qt 0) or gone,
 *                      1 when it is back in stock
 *   - spec metafields
 *
 * Runs:
 *   - automatically after every stock scan, for pieces that changed;
 *   - for ALL listed diamonds when GWEB's gold/dollar rate changes
 *     (GWEB calls /api/shopify/shop-gold-metafields) or on the
 *     "Update diamond prices now" button.
 * One at a time with a pause (Shopify REST ~2 calls/sec); never through
 * the bulk operation, so it never collides with the gold bulk sync.
 */

const PAUSE_MS = 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = (globalThis.__eleveDiamondReprice ||= { running: null, lastRun: null, repricing: null, repriceAgain: false });

export function getLastDiamondReprice() {
  return { running: Boolean(R.running), lastRun: R.lastRun };
}

async function runSync(onlyCodes, restockCodes) {
  const summary = { startedAt: new Date().toISOString(), total: 0, updated: 0, soldOut: 0, restocked: 0, errors: [] };
  const { token, domain } = await getShopifyToken();
  const [map, gweb] = await Promise.all([buildSkuVariantMap(domain, token), getAllDiamonds()]);
  const only = onlyCodes ? new Set(onlyCodes.map(String)) : null;
  const restock = new Set((restockCodes || []).map(String));

  const listed = [...map.entries()].filter(([sku]) => {
    if (!isDiamondSku(sku)) return false;
    return !only || only.has(String(diamondZcoFromSku(sku)));
  });
  summary.total = listed.length;

  for (const [sku, loc] of listed) {
    const variantId = gidToNumericId(loc.variantId);
    const item = gweb.get(String(diamondZcoFromSku(sku)));
    try {
      if (!item || !item.available) {
        await setDiamondAvailability(domain, token, variantId, false);
        summary.soldOut += 1;
      } else {
        const price = resolveDiamondPrice(item);
        if (price != null) {
          await putShopifyVariantPrice(domain, token, variantId, price.toFixed(2));
          summary.updated += 1;
        }
        if (restock.has(String(item.zco))) {
          // Sold before, in stock again in GWEB (e.g. returned) -> sellable.
          await setDiamondAvailability(domain, token, variantId, true);
          summary.restocked += 1;
        }
        await setVariantMetafields(domain, token, variantId, diamondMetafields(item));
      }
    } catch (err) {
      summary.errors.push({ sku, error: err?.message || String(err) });
    }
    await sleep(PAUSE_MS);
  }
  return summary;
}

/** Sync listed diamonds; onlyCodes limits it to pieces that changed. */
export async function syncListedDiamonds({ onlyCodes, restockCodes } = {}) {
  while (R.running) await R.running.catch(() => {});
  R.running = runSync(onlyCodes, restockCodes)
    .then((summary) => {
      summary.finishedAt = new Date().toISOString();
      R.lastRun = summary;
      if (summary.total) {
        console.log('[diamond-reprice]', JSON.stringify({ ...summary, errors: summary.errors.slice(0, 10) }));
      }
      return summary;
    })
    .catch((err) => {
      R.lastRun = { error: err?.message || String(err), finishedAt: new Date().toISOString() };
      console.error('[diamond-reprice] failed:', R.lastRun.error);
      return R.lastRun;
    })
    .finally(() => { R.running = null; });
  return R.running;
}

/**
 * Rate changed (or button): rescan GWEB, then reprice ALL listed diamonds.
 * GWEB pings on every gold/dollar tick, so calls that arrive while one is
 * running are merged into a single follow-up run instead of queueing up.
 */
export async function repriceListedDiamonds() {
  if (R.repricing) {
    R.repriceAgain = true;
    return R.repricing;
  }
  R.repricing = (async () => {
    do {
      R.repriceAgain = false;
      await fullScan({ push: false });
      await syncListedDiamonds();
    } while (R.repriceAgain);
  })().finally(() => { R.repricing = null; });
  return R.repricing;
}
