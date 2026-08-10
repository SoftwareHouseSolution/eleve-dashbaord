import { NextResponse } from 'next/server';
import { getShopifyToken } from '../../../../lib/shopify';
import { publishProductToShopify } from '../../../../lib/publishFn6Item';

export async function POST(request) {
  try {
    const body = await request.json();
    const { token, domain } = await getShopifyToken();

    const { product, shopUrl, collectWarnings } = await publishProductToShopify(domain, token, body);

    return NextResponse.json({
      product,
      shopUrl,
      ...(collectWarnings.length > 0 ? { collectWarnings } : {}),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
