import { getPublicApiBaseUrl } from './publicEnv';
import { SUPPORTED_KARATS } from './fn6Price';

function normalizePositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : null;
}

function parseGoldRatePayload(data) {
  const usdRate = Number(data.dollar) || 1;

  // Every karat Eleve sells, so an order snapshot records the rate that
  // applied to the item actually sold — not just the 18K one.
  const rates = {};
  for (const karat of SUPPORTED_KARATS) {
    const value = normalizePositiveNumber(data[`pr${karat}`]);
    if (!value) {
      throw new Error(`Invalid ${karat}K gold price from Gweb`);
    }
    rates[`pr${karat}`] = value;
  }

  return {
    ...rates,
    dollar: usdRate,
    usd_rate: usdRate,
    updated_at: data.updated_at || new Date().toISOString(),
  };
}

export async function fetchGoldRateSnapshot() {
  const base = getPublicApiBaseUrl();
  const res = await fetch(`${base}/Sup/api/gold-rate/`, { cache: 'no-store' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gold-rate fetch failed: ${res.status}${text ? ` ${text}` : ''}`);
  }

  return parseGoldRatePayload(await res.json());
}

/**
 * Gold rate that was active at a given moment (e.g. when an order was
 * placed), not whatever the rate happens to be right now. Rates change
 * throughout the day, so a webhook processed minutes after purchase must
 * not stamp the order with a later rate.
 */
export async function fetchGoldRateSnapshotAt(atIso) {
  const base = getPublicApiBaseUrl();
  const url = `${base}/Sup/api/gold-rate-at/?at=${encodeURIComponent(atIso)}`;
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gold-rate-at fetch failed: ${res.status}${text ? ` ${text}` : ''}`);
  }

  return parseGoldRatePayload(await res.json());
}
