import { getShopifyToken } from './shopify';
import { buildSkuVariantMap } from './shopifyBulkPriceSync';
import { gidToNumericId } from './shopifyProductLookup';
import { putShopifyVariantPrice } from './refreshVariantPrice';
import { isDiamondSku, resolveDiamondPrice, diamondMetafields } from './diamond';
import { fetchDiamondBySku, setVariantMetafields, setDiamondAvailability } from './diamondServer';

/**
 * Reprice every diamond already on Shopify from GWEB — no GWEB changes.
 *
 * Triggered from /api/shopify/shop-gold-metafields, which GWEB already
 * calls on every gold-rate AND dollar-rate change (Cod/signals.py), and
 * from the "Update diamond prices" button. For each "D-<zco>" variant it
 * reads GWEB's existing /Stone/api/ft5/by-zco/ lookup and writes:
 *   - variant.price  = GWEB price (s_totus x USD), 2 decimals
 *   - availability   = 0 when GWEB shows the diamond sold (qt 0)
 *   - spec metafields
 *
 * Diamonds are done one by one with a pause (Shopify allows ~2 REST
 * calls/sec), and NOT through the bulk operation, so they never collide
 * with the gold bulk sync that runs at the same moment.
 */

const PAUSE_MS = 700;
let running = false;
let lastRun = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function getLastDiamondReprice() {
  return { running, lastRun };
}

export async function repriceListedDiamonds() {
  if (running) return { started: false, reason: 'already-running' };
  running = true;
  const summary = { startedAt: new Date().toISOString(), total: 0, updated: 0, soldOut: 0, notFound: 0, errors: [] };
  try {
    const { token, domain } = await getShopifyToken();
    const map = await buildSkuVariantMap(domain, token);
    const diamonds = [...map.entries()].filter(([sku]) => isDiamondSku(sku));
    summary.total = diamonds.length;

    for (const [sku, loc] of diamonds) {
      const variantId = gidToNumericId(loc.variantId);
      try {
        const { item } = await fetchDiamondBySku(sku);
        if (!item) {
          summary.notFound += 1;
        } else {
          const price = resolveDiamondPrice(item);
          if (price != null) {
            await putShopifyVariantPrice(domain, token, variantId, price.toFixed(2));
            summary.updated += 1;
          }
          if (!item.available) {
            await setDiamondAvailability(domain, token, variantId, false);
            summary.soldOut += 1;
          }
          await setVariantMetafields(domain, token, variantId, diamondMetafields(item));
        }
      } catch (err) {
        summary.errors.push({ sku, error: err?.message || String(err) });
      }
      await sleep(PAUSE_MS);
    }
  } catch (err) {
    summary.errors.push({ sku: null, error: err?.message || String(err) });
  } finally {
    summary.finishedAt = new Date().toISOString();
    lastRun = summary;
    running = false;
    console.log('[diamond-reprice]', JSON.stringify({ ...summary, errors: summary.errors.slice(0, 10) }));
  }
  return { started: true, summary };
}
