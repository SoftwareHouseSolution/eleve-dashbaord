import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getPublicApiBaseUrl } from './publicEnv';
import { normalizeGwebDiamond } from './diamond';

/**
 * GWEB diamond stock, kept up to date automatically — no GWEB change.
 *
 * GWEB has no diamond list endpoint, only the public per-code lookup
 * /Dim/api/fd2/by-code/<code>/. Diamond codes are sequential from 1
 * (live GWEB 2026-11-24: 1..1076), so:
 *
 *   - FULL SCAN every 10 min: walks code 1.. until GAP_LIMIT unknown codes
 *     in a row (~30s). Catches sold pieces, price and stone edits.
 *   - TAIL CHECK every 60 s: looks just past the last known code, so a new
 *     piece added in GWEB shows up within a minute.
 *   - Pieces that changed and are on Shopify are pushed to Shopify right
 *     away (price, sold-out, specs) — see syncListedDiamonds.
 *
 * Stability:
 *   - The page always gets the last good list instantly; scans run behind.
 *   - The list is saved to disk, so after a restart/redeploy it is
 *     available immediately instead of waiting for the first scan.
 *   - If GWEB is down or answers with errors mid-scan, the scan is thrown
 *     away and the previous list is kept (never an empty/partial list).
 *   - One scan at a time; timers are created once per server process.
 */

const CONCURRENCY = 6;
const GAP_LIMIT = 60;
const TAIL_GAP = 15;
const HARD_MAX = 100000;
const FULL_SCAN_MS = 10 * 60 * 1000;
const TAIL_CHECK_MS = 60 * 1000;
const MAX_ERROR_RATE = 0.05;
const CACHE_FILE = path.join(os.tmpdir(), 'eleve-diamond-stock.json');

const S = (globalThis.__eleveDiamondStock ||= {
  byCode: null,      // Map code -> normalized piece (in stock AND sold)
  lastCode: 0,
  scannedAt: null,
  lastError: null,
  fullScan: null,    // in-flight promise
  tailRunning: false,
  started: false,
  diskLoad: null,    // promise of the one-time disk read
});

function baseUrl() {
  return getPublicApiBaseUrl();
}

function gwebConfigured() {
  const b = baseUrl();
  return !/example\.com|127\.0\.0\.1|localhost/.test(b);
}

class GwebError extends Error {}

async function fetchOne(code) {
  const res = await fetch(`${baseUrl()}/Dim/api/fd2/by-code/${code}/`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new GwebError(`GWEB ${res.status}`);
  const data = await res.json().catch(() => { throw new GwebError('bad JSON'); });
  return data?.code ? normalizeGwebDiamond(data) : null;
}

function fingerprint(d) {
  return [d.qty, d.price, d.carat, d.stoneCount, d.goldWeight, d.karat].join('|');
}

async function saveToDisk() {
  try {
    const payload = {
      lastCode: S.lastCode,
      scannedAt: S.scannedAt,
      items: [...S.byCode.values()],
    };
    await fs.writeFile(CACHE_FILE, JSON.stringify(payload));
  } catch { /* disk cache is best-effort */ }
}

function loadFromDisk() {
  // Read once per process; every caller awaits the same read.
  if (!S.diskLoad) {
    S.diskLoad = (async () => {
      if (S.byCode) return;
      try {
        const raw = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
        if (!S.byCode && Array.isArray(raw.items) && raw.items.length) {
          S.byCode = new Map(raw.items.map((d) => [String(d.zco), d]));
          S.lastCode = raw.lastCode || 0;
          S.scannedAt = raw.scannedAt || null;
        }
      } catch { /* no cache yet */ }
    })();
  }
  return S.diskLoad;
}

async function pushChangesToShopify({ changed, restocked }) {
  if (!changed.length) return;
  try {
    const { syncListedDiamonds } = await import('./diamondReprice');
    await syncListedDiamonds({ onlyCodes: changed, restockCodes: restocked });
  } catch (err) {
    console.error('[diamond-stock] Shopify sync failed:', err?.message || err);
  }
}

async function runFullScan() {
  const found = new Map();
  let lastHit = 0;
  let next = 1;
  let stop = false;
  let errors = 0;
  let checked = 0;

  const worker = async () => {
    while (!stop) {
      const code = next++;
      if (code > HARD_MAX) { stop = true; break; }
      checked += 1;
      try {
        const d = await fetchOne(code);
        if (d) {
          found.set(String(d.zco), d);
          if (code > lastHit) lastHit = code;
        } else if (code - lastHit > GAP_LIMIT) {
          stop = true;
        }
      } catch {
        errors += 1;
        if (errors > 20 && errors / checked > MAX_ERROR_RATE) stop = true;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (found.size === 0 || errors / Math.max(checked, 1) > MAX_ERROR_RATE) {
    throw new Error(`GWEB scan unreliable (${errors} errors of ${checked}); keeping previous list`);
  }

  const prev = S.byCode;
  const changed = [];
  const restocked = [];
  if (prev) {
    for (const [code, d] of found) {
      const old = prev.get(code);
      if (!old || fingerprint(old) !== fingerprint(d)) changed.push(code);
      if (old && !old.available && d.available) restocked.push(code);
    }
    for (const code of prev.keys()) if (!found.has(code)) changed.push(code);
  }

  S.byCode = found;
  S.lastCode = lastHit;
  S.scannedAt = new Date().toISOString();
  S.lastError = null;
  await saveToDisk();
  console.log(`[diamond-stock] full scan: ${found.size} pieces, last code ${lastHit}, ${changed.length} changed`);
  return { changed, restocked };
}

/**
 * Start (or join) a full scan. Never throws; failures keep the old list.
 * Pieces that changed are pushed to Shopify unless push=false.
 */
export function fullScan({ push = true } = {}) {
  if (!S.fullScan) {
    S.fullScan = runFullScan()
      .then((diff) => { if (push) pushChangesToShopify(diff); return diff; })
      .catch((err) => {
        S.lastError = err?.message || String(err);
        console.error('[diamond-stock]', S.lastError);
        return { changed: [], restocked: [] };
      })
      .finally(() => { S.fullScan = null; });
  }
  return S.fullScan;
}

/** Cheap check just past the last known code: picks up new pieces fast. */
async function tailCheck() {
  if (S.tailRunning || S.fullScan || !S.byCode) return;
  S.tailRunning = true;
  try {
    const added = [];
    let misses = 0;
    let code = S.lastCode + 1;
    while (misses < TAIL_GAP && code <= HARD_MAX) {
      const d = await fetchOne(code);
      if (d) {
        S.byCode.set(String(d.zco), d);
        S.lastCode = code;
        added.push(String(d.zco));
        misses = 0;
      } else {
        misses += 1;
      }
      code += 1;
    }
    if (added.length) {
      await saveToDisk();
      console.log(`[diamond-stock] ${added.length} new piece(s): ${added.join(', ')}`);
    }
  } catch { /* GWEB hiccup — next tick retries */ } finally {
    S.tailRunning = false;
  }
}

/** Create the background timers once per server process. */
export function startDiamondStockSync() {
  if (S.started || !gwebConfigured()) return;
  S.started = true;
  loadFromDisk().then(() => fullScan());
  const full = setInterval(() => fullScan(), FULL_SCAN_MS);
  const tail = setInterval(() => tailCheck(), TAIL_CHECK_MS);
  full.unref?.();
  tail.unref?.();
}

/** Every piece GWEB knows (in stock and sold) — used by the Shopify sync. */
export async function getAllDiamonds() {
  await loadFromDisk();
  if (!S.byCode) await fullScan();
  return S.byCode || new Map();
}

/**
 * In-stock pieces for the Diamonds page. Returns the saved list instantly;
 * only the very first run (nothing saved yet) waits for a scan.
 * refresh=true waits for a fresh full scan.
 */
export async function getDiamondStock({ refresh = false } = {}) {
  startDiamondStockSync();
  await loadFromDisk();
  if (refresh || !S.byCode) await fullScan();
  const items = S.byCode
    ? [...S.byCode.values()].filter((d) => d.available).sort((a, b) => Number(a.zco) - Number(b.zco))
    : [];
  return {
    items,
    lastCode: S.lastCode,
    scannedAt: S.scannedAt,
    updating: Boolean(S.fullScan),
    lastError: S.lastError,
  };
}
