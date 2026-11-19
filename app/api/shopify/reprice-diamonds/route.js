import { NextResponse } from 'next/server';
import { getLastDiamondReprice, repriceListedDiamonds } from '../../../../lib/diamondReprice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — start a diamond reprice now (runs in the background). */
export async function POST() {
  const state = getLastDiamondReprice();
  if (state.running) return NextResponse.json({ started: false, reason: 'already-running' });
  repriceListedDiamonds().catch((err) => console.error('[diamond-reprice] failed:', err));
  return NextResponse.json({ started: true });
}

/** GET — status of the current / last run. */
export async function GET() {
  return NextResponse.json(getLastDiamondReprice());
}
