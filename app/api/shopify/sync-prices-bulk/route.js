import { NextResponse } from 'next/server';
import { getShopifyToken } from '../../../../lib/shopify';
import { getCurrentBulkOperation, startBulkPriceSync } from '../../../../lib/shopifyBulkPriceSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Whole-catalog price sync, triggered by Gweb's gp post_save signal on
 * every gold-rate change (Cod/signals.py -> Cod/shopify_sync.py). Replaces
 * the old per-SKU refresh-price-bulk sweep, which hit Shopify's 2 req/sec
 * limit and silently left SKUs stale under real catalog size.
 *
 * Body: {
 *   rates:   { pr18, pr21, pr24, usd_rate },   // per-karat per-gram rates
 *   pr18:    string|number,                    // legacy, superseded by rates
 *   updates: Array<{ mco, price, co, weight?, prc?, prcus? }>
 * }
 *
 * `price` is computed by GWEB (Sup/pricing.py) at each item's own karat —
 * it is written to variant.price verbatim, never recomputed here. That is
 * what keeps the dashboard, the storefront and checkout on one number.
 *
 * Uses Shopify's Bulk Operations API (see lib/shopifyBulkPriceSync.js),
 * which runs OUTSIDE the rate limit — this call only starts it and
 * returns immediately; the write itself completes asynchronously on
 * Shopify's side, typically within seconds for a catalog this size.
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const updates = Array.isArray(body.updates) ? body.updates : [];
  // Prefer the per-karat rate map; fall back to a lone pr18 so an older
  // GWEB deploy still syncs (18K items keep their audit metafield).
  const rates = body.rates && typeof body.rates === 'object'
    ? body.rates
    : (body.pr18 != null ? { pr18: body.pr18 } : null);

  if (updates.length === 0) {
    return NextResponse.json({ started: false, reason: 'no-updates' });
  }

  try {
    const { token, domain } = await getShopifyToken();

    // Only one bulkOperationRunMutation may run per shop at a time. The
    // sweep is a full, idempotent rewrite, so if one is already running
    // we skip this tick entirely — the next gold-rate change will fire
    // another sweep that supersedes whatever this one would have done.
    const current = await getCurrentBulkOperation(domain, token);
    if (current && current.status === 'RUNNING') {
      return NextResponse.json({
        started: false,
        reason: 'bulk-operation-already-running',
        currentBulkOperation: current,
      });
    }

    const result = await startBulkPriceSync(domain, token, updates, rates);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 502 });
  }
}

/** Poll the status of the most recent bulk price sync. */
export async function GET() {
  try {
    const { token, domain } = await getShopifyToken();
    const current = await getCurrentBulkOperation(domain, token);
    return NextResponse.json({ currentBulkOperation: current });
  } catch (err) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 502 });
  }
}
