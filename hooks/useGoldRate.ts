import { useQuery } from '@tanstack/react-query';
import { getPublicApiBaseUrl } from '../lib/publicEnv';
import { computeFn6Price, goldPriceForKarat } from '../lib/fn6Price';

export interface GoldRate {
  pr18: number;
  pr21: number;
  pr24: number;
  dollar: number;
  updated_at: string;
}

async function fetchGoldRate(): Promise<GoldRate> {
  const base = getPublicApiBaseUrl();
  const res = await fetch(`${base}/Sup/api/gold-rate/`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return {
    pr18: Number(data.pr18),
    pr21: Number(data.pr21),
    pr24: Number(data.pr24),
    dollar: Number(data.dollar),
    updated_at: data.updated_at,
  };
}

export function useGoldRate() {
  return useQuery({
    queryKey: ['gold-rate'],
    queryFn: fetchGoldRate,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 2,
  });
}

/**
 * Live price preview for a piece at a given karat. `karat` is required —
 * pricing every item at 18K was a KingGold-only shortcut (that store is
 * 18K-only) and is wrong for Eleve, which sells 18K, 21K and 24K.
 */
export function computeLivePrice(
  goldRate: GoldRate | undefined,
  karat: number | string | null,
  weight: number | string | null,
  prc: number | string | null,
  prcus: number | string | null,
): number | null {
  const gold = goldPriceForKarat(goldRate, karat);
  if (gold == null) return null;
  return computeFn6Price({
    gold,
    usdRate: goldRate?.dollar,
    weight: Number(weight),
    prc: Number(prc),
    prcus: Number(prcus),
  });
}
