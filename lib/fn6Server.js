import { getPublicApiBaseUrl } from './publicEnv';
import { roundToNearest5 } from './fn6Price';

/** Server-side FN6/GWEB lookup (no auth token — public read endpoint). */
export async function fetchFn6ByMco(sku) {
  const normalizedSku = String(sku || '').trim();
  if (!normalizedSku) return { item: null, normalizedSku };

  const base = getPublicApiBaseUrl();
  const fn6Res = await fetch(
    `${base}/Sup/api/fn6/by-mco/${encodeURIComponent(normalizedSku)}/`,
  );

  if (fn6Res.status === 404) {
    return { item: null, normalizedSku };
  }

  if (!fn6Res.ok) {
    const text = await fn6Res.text().catch(() => '');
    throw new Error(`FN6 fetch failed: ${fn6Res.status}${text ? ` ${text}` : ''}`);
  }

  const item = await fn6Res.json();
  return { item, normalizedSku };
}

export function roundedFn6Price(item) {
  if (!item || item.price == null || item.price === '') return null;
  // roundToNearest5 mirrors Sup/pricing.py's `(int(x) + 2) // 5 * 5`.
  // Math.round(n / 5) * 5 is NOT the same and drifts by 5 EGP — see the
  // note at the top of lib/fn6Price.js.
  const rounded = roundToNearest5(Number(item.price));
  return Number.isFinite(rounded) ? String(rounded) : null;
}
