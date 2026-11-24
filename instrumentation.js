/**
 * Next.js runs register() once when the server starts. We use it to start
 * the diamond stock background sync (lib/diamondStock.js), so the Diamonds
 * page is ready and kept current without anyone opening it first.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startDiamondStockSync } = await import('./lib/diamondStock');
    startDiamondStockSync();
  }
}
