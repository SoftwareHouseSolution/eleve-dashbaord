import { shopifyGraphql } from './shopifyProductLookup';
import {
  GWEBMETA_NAMESPACE,
  GWEB_WEIGHT_METAFIELD_KEY,
  GWEB_WEIGHT_METAFIELD_TYPE,
  GWEB_PRC_METAFIELD_KEY,
  GWEB_PRC_METAFIELD_TYPE,
  GWEB_PRCUS_METAFIELD_KEY,
  GWEB_PRCUS_METAFIELD_TYPE,
  GWEB_PR18_USED_METAFIELD_KEY,
  GWEB_PR18_USED_METAFIELD_TYPE,
  formatGwebWeightDisplay,
} from './gwebWeightMetafield';

/**
 * Whole-catalog price sync via Shopify's Bulk Operations API, which runs
 * OUTSIDE the normal 2 req/sec rate limit (only the call that starts it is
 * rate-limited — one call, regardless of catalog size). This replaces the
 * old per-SKU REST PUT sweep (refresh-price-bulk), which could not finish
 * a full catalog inside one gold-rate tick and silently left SKUs stale.
 *
 * See: https://shopify.dev/docs/api/usage/bulk-operations/queries
 */

const API_VERSION = '2024-10';
const VARIANT_PAGE_SIZE = 250;

const VARIANT_MAP_QUERY = `
  query VariantSkuMap($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        product { id }
      }
    }
  }
`;

/** Build sku -> { variantId, productId } for the whole catalog. Plain paginated
 * query, not a bulk operation — 707 variants / 250 per page = 3 calls, well
 * under the rate limit on its own. */
export async function buildSkuVariantMap(domain, token) {
  const map = new Map();
  let after = null;
  for (;;) {
    const data = await shopifyGraphql(domain, token, VARIANT_MAP_QUERY, {
      first: VARIANT_PAGE_SIZE,
      after,
    });
    const conn = data?.productVariants;
    for (const node of conn?.nodes || []) {
      const sku = String(node?.sku || '').trim();
      if (!sku || !node?.id || !node?.product?.id) continue;
      map.set(sku, { variantId: node.id, productId: node.product.id });
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return map;
}

const CURRENT_BULK_OP_QUERY = `
  query CurrentBulkOperation {
    currentBulkOperation(type: MUTATION) {
      id
      status
      errorCode
      objectCount
      url
      partialDataUrl
    }
  }
`;

export async function getCurrentBulkOperation(domain, token) {
  const data = await shopifyGraphql(domain, token, CURRENT_BULK_OP_QUERY, {});
  return data?.currentBulkOperation || null;
}

const STAGED_UPLOADS_CREATE = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url parameters { name value } }
      userErrors { field message }
    }
  }
`;

async function createStagedUpload(domain, token) {
  const data = await shopifyGraphql(domain, token, STAGED_UPLOADS_CREATE, {
    input: [{
      resource: 'BULK_MUTATION_VARIABLES',
      filename: 'kg-price-sync.jsonl',
      mimeType: 'text/jsonl',
      httpMethod: 'POST',
    }],
  });
  const errors = data?.stagedUploadsCreate?.userErrors;
  if (errors?.length) throw new Error(`stagedUploadsCreate: ${errors.map((e) => e.message).join('; ')}`);
  const target = data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error('stagedUploadsCreate returned no target URL');
  return target;
}

async function uploadJsonl(target, jsonlContent) {
  const form = new FormData();
  for (const { name, value } of target.parameters || []) {
    form.append(name, value);
  }
  const keyParam = (target.parameters || []).find((p) => p.name === 'key');
  const file = new Blob([jsonlContent], { type: 'text/jsonl' });
  form.append('file', file, 'kg-price-sync.jsonl');

  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`staged upload failed: ${res.status} ${text}`);
  }
  return keyParam?.value;
}

const BULK_MUTATION_RUN = `
  mutation BulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

// One JSONL line per PRODUCT — productVariantsBulkUpdate groups variants by
// their parent product, so multiple variant updates for the same product
// must be combined into a single line's `variants` array.
const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `
  mutation call($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product { id }
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

/**
 * Build the JSONL body: one line per product, each with its updated
 * variants. Alongside the price we write two audit metafields atomically,
 * so the recorded karat and rate can never disagree with the price they
 * produced:
 *   custom.gweb_karat     — the item's karat (18/21/24)
 *   custom.gweb_pr18_used — the per-gram rate actually used for THAT karat
 *
 * `rates` is {pr18, pr21, pr24} from GWEB; each item's own `co` selects
 * which one applies. (The gweb_pr18_used key keeps its historical name so
 * existing Shopify metafield definitions and reports don't break.)
 */
export function buildBulkUpdateJsonl(updates, skuMap, rates) {
  const byProduct = new Map();
  const skipped = [];

  for (const u of updates) {
    const sku = String(u?.mco || '').trim();
    const price = Number(u?.price);
    if (!sku || !Number.isFinite(price) || price <= 0) {
      skipped.push({ sku, reason: 'invalid-price' });
      continue;
    }
    const loc = skuMap.get(sku);
    if (!loc) {
      skipped.push({ sku, reason: 'not-found-in-shopify' });
      continue;
    }

    const variantInput = {
      id: loc.variantId,
      price: String(price),
    };

    const karat = Number(u?.co);
    const rateUsed = Number(rates?.[`pr${karat}`]);
    const metafields = [];
    if (Number.isFinite(karat) && karat > 0) {
      metafields.push({
        namespace: GWEBMETA_NAMESPACE,
        key: 'gweb_karat',
        type: 'number_integer',
        value: String(karat),
      });
    }
    if (Number.isFinite(rateUsed) && rateUsed > 0) {
      metafields.push({
        namespace: GWEBMETA_NAMESPACE,
        key: GWEB_PR18_USED_METAFIELD_KEY,
        type: GWEB_PR18_USED_METAFIELD_TYPE,
        value: String(rateUsed),
      });
    }

    // Refresh weight/prc/prcus in the SAME operation as the price. These
    // used to be written only by the single-SKU refresh path, so the sweep
    // left them behind: a live KingGold variant carries gweb_prc 413 while
    // its price was actually computed from a catalog charge of 465. Anyone
    // reading the metafields got a number 1,005 EGP off the real price.
    // GWEB already sends these fields per item — write them.
    const weightDisplay = formatGwebWeightDisplay(u?.weight);
    if (weightDisplay) {
      metafields.push({
        namespace: GWEBMETA_NAMESPACE,
        key: GWEB_WEIGHT_METAFIELD_KEY,
        type: GWEB_WEIGHT_METAFIELD_TYPE,
        value: weightDisplay,
      });
    }
    for (const [field, key, type] of [
      ['prc', GWEB_PRC_METAFIELD_KEY, GWEB_PRC_METAFIELD_TYPE],
      ['prcus', GWEB_PRCUS_METAFIELD_KEY, GWEB_PRCUS_METAFIELD_TYPE],
    ]) {
      const value = Number(u?.[field]);
      if (Number.isFinite(value)) {
        metafields.push({ namespace: GWEBMETA_NAMESPACE, key, type, value: String(value) });
      }
    }

    if (metafields.length) variantInput.metafields = metafields;

    if (!byProduct.has(loc.productId)) byProduct.set(loc.productId, []);
    byProduct.get(loc.productId).push(variantInput);
  }

  const lines = [];
  for (const [productId, variants] of byProduct) {
    lines.push(JSON.stringify({ productId, variants }));
  }

  return { jsonl: lines.join('\n'), productCount: byProduct.size, skipped };
}

/**
 * Kick off (does not wait for completion) a Bulk Operation that writes
 * `updates` (from Gweb's shopify_sync.py: [{mco, price, co, weight, prc,
 * prcus}]) to Shopify variant prices in one call, bypassing the rate
 * limit entirely.
 *
 * Only one bulkOperationRunMutation may run per shop at a time — callers
 * must check getCurrentBulkOperation() first and skip if RUNNING (the
 * sweep is a full, idempotent rewrite, so the next gold tick supersedes
 * a skipped one; no need to queue).
 */
export async function startBulkPriceSync(domain, token, updates, rates) {
  const skuMap = await buildSkuVariantMap(domain, token);
  const { jsonl, productCount, skipped } = buildBulkUpdateJsonl(updates, skuMap, rates);

  if (productCount === 0) {
    return { started: false, reason: 'no-updates', skipped };
  }

  const target = await createStagedUpload(domain, token);
  const stagedUploadPath = await uploadJsonl(target, jsonl);
  if (!stagedUploadPath) throw new Error('staged upload did not return a key');

  const data = await shopifyGraphql(domain, token, BULK_MUTATION_RUN, {
    mutation: PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
    stagedUploadPath,
  });
  const errors = data?.bulkOperationRunMutation?.userErrors;
  if (errors?.length) throw new Error(`bulkOperationRunMutation: ${errors.map((e) => e.message).join('; ')}`);

  const bulkOperation = data?.bulkOperationRunMutation?.bulkOperation;
  return { started: true, bulkOperation, productCount, skipped };
}

export { API_VERSION };
