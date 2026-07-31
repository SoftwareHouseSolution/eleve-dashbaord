import { NextResponse } from 'next/server';
import { getPublicApiBaseUrl } from '../../../../lib/publicEnv';
import { SUPPORTED_KARATS } from '../../../../lib/fn6Price';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Cache-Control': 'public, max-age=30',
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

/**
 * GET — live per-gram gold price for every karat Eleve sells, plus the
 * USD→EGP rate.
 *
 * `dollar` is echoed alongside `usd_rate` so the payload can be handed
 * straight to resolveFn6Price()/goldPriceForKarat() without reshaping.
 *
 * Back-office use only. The storefront must not price from this — it
 * renders variant.price, kept current by the bulk sync.
 */
export async function GET() {
  const base = getPublicApiBaseUrl();

  try {
    const res = await fetch(
      `${base}/Sup/api/gold-rate/`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      return json({ error: `Gold-rate fetch failed: ${res.status}` }, 502);
    }
    const data = await res.json();

    const usdRate = Number(data.dollar) || 1;
    const round2 = (n) => Math.round(n * 100) / 100;

    const out = { usd_rate: usdRate, dollar: usdRate };
    for (const karat of SUPPORTED_KARATS) {
      const value = Number(data[`pr${karat}`]);
      if (!Number.isFinite(value) || value <= 0) {
        return json({ error: `Invalid ${karat}K gold price from Gweb` }, 502);
      }
      out[`pr${karat}`] = round2(value);
    }

    return json({ ...out, updated_at: data.updated_at || new Date().toISOString() });
  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
