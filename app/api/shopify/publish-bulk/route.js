import { NextResponse } from 'next/server';
import { getShopifyToken } from '../../../../lib/shopify';
import { fetchFn6ByMco } from '../../../../lib/fn6Server';
import { fetchGoldRateSnapshot } from '../../../../lib/goldRates';
import { findShopifyVariantBySkuOnly } from '../../../../lib/shopifyProductLookup';
import { publishProductToShopify } from '../../../../lib/publishFn6Item';
import { BULK_CHUNK_SIZE, buildBulkPublishBody } from '../../../../lib/bulkImport';

/**
 * Publish one chunk of GWEB items to Shopify.
 *
 * The browser drives the loop and calls this once per chunk, which keeps
 * each invocation short and makes the whole run resumable: if the tab dies
 * mid-import, re-running skips everything that already landed because of
 * the per-item "already listed" check below.
 *
 * Items are published one at a time on purpose. Shopify's REST bucket
 * refills at 2 calls/sec, so parallelising here buys nothing and earns 429s.
 */

export const maxDuration = 300;

async function fetchGoldRates() {
  // Only needed as a fallback for Fn6 responses that predate the `price`
  // field; resolveFn6Price prefers GWEB's own number when it is present.
  // A rate outage must not fail the whole chunk — items that still carry a
  // GWEB price publish fine, and the rest surface as "no valid price".
  try {
    return await fetchGoldRateSnapshot();
  } catch {
    return null;
  }
}

async function publishOne(domain, token, code, rates, defaults) {
  const mco = String(code || '').trim();
  if (!mco) return { mco: code, outcome: 'failed', reason: 'Empty code', warnings: [] };

  try {
    const existing = await findShopifyVariantBySkuOnly(domain, token, mco);
    if (existing?.found) {
      return { mco, outcome: 'skipped', reason: 'Already on Shopify', warnings: [] };
    }

    const { item } = await fetchFn6ByMco(mco);
    if (!item) {
      return { mco, outcome: 'failed', reason: 'Not found in GWEB', warnings: [] };
    }

    const body = buildBulkPublishBody(item, rates, defaults);
    const warnings = body.images.length === 0 ? ['No photos — add them later'] : [];

    const { product, shopUrl, collectWarnings } = await publishProductToShopify(domain, token, body);

    return {
      mco,
      outcome: 'published',
      title: body.title,
      price: body.price,
      productId: product?.id ?? null,
      shopUrl,
      warnings: [...warnings, ...(collectWarnings || [])],
    };
  } catch (err) {
    return { mco, outcome: 'failed', reason: err?.message || 'Publish failed', warnings: [] };
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const codes = Array.isArray(body?.codes)
      ? body.codes.map(c => String(c).trim()).filter(Boolean)
      : [];

    if (codes.length === 0) {
      return NextResponse.json({ error: 'No item codes supplied' }, { status: 400 });
    }
    if (codes.length > BULK_CHUNK_SIZE) {
      return NextResponse.json(
        { error: `Send at most ${BULK_CHUNK_SIZE} codes per request` },
        { status: 400 },
      );
    }

    const { token, domain } = await getShopifyToken();
    const rates = await fetchGoldRates();
    const defaults = body?.defaults || {};

    const results = [];
    for (const code of codes) {
      results.push(await publishOne(domain, token, code, rates, defaults));
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
