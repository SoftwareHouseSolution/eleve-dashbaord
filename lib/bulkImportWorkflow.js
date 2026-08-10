import { BULK_CHUNK_SIZE, chunk } from './bulkImport';
import { parseApiJson } from './shopifyItemWorkflow';

/** Every SKU already on Shopify, as a Set for cheap membership tests. */
export async function fetchListedSkus() {
  const res = await fetch('/api/shopify/listed-skus');
  const data = await parseApiJson(res);
  if (!res.ok) throw new Error(data.error || 'Failed to read Shopify catalog');
  return new Set((data.skus || []).map(String));
}

async function publishChunk(codes, defaults, signal) {
  const res = await fetch('/api/shopify/publish-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes, defaults }),
    signal,
  });
  const data = await parseApiJson(res);
  if (!res.ok) throw new Error(data.error || 'Bulk publish failed');
  return data.results || [];
}

/**
 * Publish `codes` chunk by chunk, reporting after every chunk.
 *
 * The loop lives in the browser so a 1000-item run isn't one enormous
 * request that a serverless timeout can kill halfway. `shouldStop` is polled
 * between chunks — Stop finishes the chunk in flight rather than abandoning
 * items whose Shopify products may already exist.
 */
export async function runBulkPublish(codes, {
  defaults = {},
  onProgress,
  shouldStop,
  signal,
} = {}) {
  const chunks = chunk(codes, BULK_CHUNK_SIZE);
  const results = [];
  let stopped = false;

  for (const batch of chunks) {
    if (shouldStop?.()) {
      stopped = true;
      break;
    }
    try {
      const batchResults = await publishChunk(batch, defaults, signal);
      results.push(...batchResults);
    } catch (err) {
      // A whole chunk failed (network drop, auth, timeout). Record every
      // code in it as failed so the report accounts for all 1000 items,
      // then keep going — one bad chunk shouldn't end the run.
      for (const code of batch) {
        results.push({
          mco: code,
          outcome: 'failed',
          reason: err?.message || 'Request failed',
          warnings: [],
        });
      }
    }
    onProgress?.({ done: results.length, total: codes.length, results });
  }

  return { results, stopped };
}
