import { NextResponse } from 'next/server';
import { getDiamondStock } from '../../../../lib/diamondStock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/diamonds/stock[?refresh=1] — every GWEB diamond piece in stock. */
export async function GET(request) {
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    const stock = await getDiamondStock({ refresh });
    return NextResponse.json({ count: stock.items.length, ...stock });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to load diamond stock' }, { status: 502 });
  }
}
