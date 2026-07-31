import { NextResponse } from 'next/server';
import { getPublicApiBaseUrl } from '../../../../lib/publicEnv';
import { resolveFn6Price, goldPriceForKarat } from '../../../../lib/fn6Price';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Cache-Control': 'public, max-age=15',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const MAX_SKUS = 50;
const PER_SKU_TIMEOUT_MS = 2500;

/**
 * GET — batch price lookup, one entry per SKU.
 *
 * ?skus=A,B,C (max 50) → fetches each SKU by-mco from GWEB and returns
 * { [sku]: { price, weight, karat, gold_rate, prc, prcus } }. The price is
 * GWEB's own (Sup/pricing.py), at the item's own karat — not recomputed here.
 *
 * Diagnostic/back-office use. The storefront must NOT price from this: it
 * renders variant.price, which the bulk sync keeps current. A browser-side
 * price painted over variant.price is exactly what drifted from the checkout
 * charge on KingGold and got removed.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const skusParam = (searchParams.get('skus') || '').trim();
  if (!skusParam) {
    return json({ error: 'skus query param required' }, 400);
  }

  const skus = skusParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_SKUS);
  if (skus.length === 0) {
    return json({ error: 'no valid SKUs' }, 400);
  }

  const base = getPublicApiBaseUrl();

  // Fetch the gold rate once. Kept for the fallback path and for reporting
  // which per-gram rate applies to each item's karat.
  let rates = null;
  try {
    const rateRes = await fetch(`${base}/Sup/api/gold-rate/`, { cache: 'no-store' });
    if (rateRes.ok) rates = await rateRes.json();
  } catch {
    // continue — each item falls back to GWEB's own `price` field
  }

  const results = {};

  await Promise.all(skus.map(async (sku) => {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PER_SKU_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(
          `${base}/Sup/api/fn6/by-mco/${encodeURIComponent(sku)}/`,
          { cache: 'no-store', signal: ac.signal },
        );
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        results[sku] = { found: false, error: `HTTP ${res.status}` };
        return;
      }
      const item = await res.json();
      const price = resolveFn6Price(item, rates);
      const goldForItem = goldPriceForKarat(rates, item?.co);
      results[sku] = {
        found: true,
        price: price != null ? String(price) : null,
        weight: item?.go_cr != null ? `${Number(item.go_cr).toFixed(2)}g` : null,
        karat: item?.co != null ? Number(item.co) : null,
        gold_rate: goldForItem != null ? Math.round(goldForItem * 100) / 100 : null,
        prc: item?.prc != null && item.prc !== '' ? Number(item.prc) : 0,
        prcus: item?.prcus != null && item.prcus !== '' ? Number(item.prcus) : 0,
      };
    } catch (e) {
      results[sku] = { found: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
    }
  }));

  return json({ prices: results, count: Object.keys(results).length });
}
