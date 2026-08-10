import { NextResponse } from 'next/server';
import { getShopifyToken } from '../../../../lib/shopify';
import { buildSkuVariantMap } from '../../../../lib/shopifyBulkPriceSync';

/**
 * Every SKU that already has a Shopify variant.
 *
 * The bulk import tab uses this to grey out items that are already listed,
 * so a second run after an interrupted import doesn't create duplicates.
 * buildSkuVariantMap pages 250 variants per GraphQL call, so the whole
 * catalog costs a handful of calls rather than one lookup per item.
 */
export async function GET() {
  try {
    const { token, domain } = await getShopifyToken();
    const map = await buildSkuVariantMap(domain, token);
    return NextResponse.json({ skus: Array.from(map.keys()), count: map.size });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
