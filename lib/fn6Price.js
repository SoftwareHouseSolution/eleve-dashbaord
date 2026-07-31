/**
 * Price helpers for the dashboard.
 *
 * IMPORTANT: this is NOT a second definition of the price formula. GWEB's
 * Sup/pricing.py owns the formula; every Fn6 API response already carries a
 * `price` field computed there, and that same function feeds the
 * variant.price sync to Shopify. Prefer resolveFn6Price(), which returns
 * GWEB's number.
 *
 * computeFn6Price() below is a LAST-RESORT fallback for when an API response
 * predates the `price` field. It mirrors Sup/pricing.py line for line —
 * including the gco catalog making-charge branches and the exact rounding —
 * because the previous JS copy omitted both and that is precisely how the
 * dashboard, the scan page and the storefront ended up showing three
 * different numbers for the same piece.
 */

// Karats Eleve sells. Mirrors SUPPORTED_KARATS in gweb/Sup/pricing.py.
export const SUPPORTED_KARATS = [18, 21, 24];

/**
 * Truncate to a whole unit, then snap to the nearest 5 — a faithful port of
 * Python's `(int(x) + 2) // 5 * 5`. Do NOT substitute Math.round(n / 5) * 5:
 * that rounds the fractional part first and disagrees with GWEB (18832.9
 * becomes 18830 here and 18835 there).
 */
export function roundToNearest5(n) {
  if (!Number.isFinite(n)) return null;
  const truncated = Math.floor(n);
  return Math.floor((truncated + 2) / 5) * 5;
}

/** Per-gram rate for a karat, from a gold-rate response ({pr18, pr21, pr24}). */
export function goldPriceForKarat(rates, karat) {
  const co = Number(karat);
  if (!SUPPORTED_KARATS.includes(co)) return null;
  const value = Number(rates?.[`pr${co}`]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Fallback computation — mirrors Sup.pricing.compute_item_price exactly.
 * Making-charge priority: gco.pr_us > prcus > gco.pr > prc > pure gold.
 */
export function computeFn6Price({ gold, usdRate, weight, prc, prcus, gcoPr, gcoPrUs }) {
  const g = Number(gold);
  const w = Number(weight);
  if (!Number.isFinite(g) || g <= 0) return null;
  if (!Number.isFinite(w) || w <= 0) return null;

  const rate = Number.isFinite(Number(usdRate)) && Number(usdRate) > 0 ? Number(usdRate) : 1;
  const p = Number.isFinite(Number(prc)) ? Number(prc) : 0;
  const pu = Number.isFinite(Number(prcus)) ? Number(prcus) : 0;
  const cp = Number.isFinite(Number(gcoPr)) ? Number(gcoPr) : 0;
  const cpu = Number.isFinite(Number(gcoPrUs)) ? Number(gcoPrUs) : 0;

  let total;
  if (cpu > 0) total = ((cpu + g / rate) * w) * rate;
  else if (pu > 0) total = ((pu + g / rate) * w) * rate;
  else if (cp > 0) total = (cp + g) * w;
  else if (p > 0) total = (p + g) * w;
  else total = g * w;

  return roundToNearest5(total);
}

/**
 * The price for an Fn6 item. Returns GWEB's authoritative `price` when the
 * API supplied one; otherwise recomputes from the item's own karat.
 *
 * @param item  an /Sup/api/fn6/ or /by-mco/ response object
 * @param rates a /Sup/api/gold-rate/ response ({pr18, pr21, pr24, dollar})
 */
export function resolveFn6Price(item, rates) {
  const fromGweb = Number(item?.price);
  if (Number.isFinite(fromGweb) && fromGweb > 0) return roundToNearest5(fromGweb);

  const gold = goldPriceForKarat(rates, item?.co);
  if (gold == null) return null;

  return computeFn6Price({
    gold,
    usdRate: Number(rates?.dollar ?? rates?.usd_rate),
    weight: Number(item?.go_cr),
    prc: Number(item?.prc),
    prcus: Number(item?.prcus),
    gcoPr: Number(item?.gco_pr),
    gcoPrUs: Number(item?.gco_pr_us),
  });
}
