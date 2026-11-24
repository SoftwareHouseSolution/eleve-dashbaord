import { getPublicApiBaseUrl } from './publicEnv';
import { shopifyGraphql } from './shopifyProductLookup';
import { diamondZcoFromSku, normalizeGwebDiamond } from './diamond';

/**
 * Server-side GWEB diamond lookup through GWEB's EXISTING public endpoint
 * /Dim/api/fd2/by-code/<code>/ (Dim.Fd2, diamond jewelry). An unknown code
 * comes back as 200 with empty fields, which normalizes to null.
 */
export async function fetchDiamondBySku(sku) {
  const zco = diamondZcoFromSku(sku);
  if (!zco) return { item: null, zco };

  const base = getPublicApiBaseUrl();
  const res = await fetch(`${base}/Dim/api/fd2/by-code/${encodeURIComponent(zco)}/`, {
    cache: 'no-store',
  });
  if (res.status === 404) return { item: null, zco };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Diamond fetch failed: ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
  }
  return { item: normalizeGwebDiamond(await res.json()), zco };
}

const METAFIELDS_SET = `
  mutation SetVariantMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/**
 * Write several metafields on one variant in ONE GraphQL call (metafieldsSet
 * upserts), instead of 2 REST calls per field — keeps bulk publish inside
 * Shopify's rate limit.
 */
export async function setVariantMetafields(domain, token, variantId, metafields) {
  if (!variantId || !Array.isArray(metafields) || metafields.length === 0) return;
  const ownerId = String(variantId).startsWith('gid://')
    ? String(variantId)
    : `gid://shopify/ProductVariant/${variantId}`;
  const data = await shopifyGraphql(domain, token, METAFIELDS_SET, {
    metafields: metafields.map((m) => ({ ...m, ownerId })),
  });
  const errors = data?.metafieldsSet?.userErrors;
  if (errors?.length) {
    throw new Error(`metafieldsSet: ${errors.map((e) => e.message).join('; ')}`);
  }
}

/**
 * Binary availability for a diamond variant (qty 1 / 0). Same two writes as
 * codeChainService.setVariantAvailability — duplicated here because
 * importing codeChainService from the price-refresh path would be circular.
 */
export async function setDiamondAvailability(domain, token, variantId, available) {
  const { applyVariantInventoryFromBody } = await import('./shopifyInventory');
  const body = { inventory_management: 'shopify', inventory_quantity: available ? 1 : 0 };
  await fetch(`https://${domain}/admin/api/2024-10/variants/${variantId}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ variant: { id: Number(variantId), ...body } }),
  });
  await applyVariantInventoryFromBody(domain, token, body, variantId);
}
