/**
 * Diamond helpers shared by the browser (Diamonds page) and the server
 * (publish, price refresh, bulk sync). Pure functions only.
 *
 * Diamonds live in GWEB's Dim.Fd2 table and reach Shopify under the SKU
 * "D-<zco>", so a diamond code can never collide with a gold mco.
 *
 * Source: GWEB Dim.Fd2 (diamond jewelry). Existing lookup:
 * /Dim/api/fd2/by-code/<code>/. Its `price` is totus_dr_r x USD rate,
 * computed by GWEB; we only cut it to 2 decimals (no rounding to 5).
 * The lookup returns sold pieces too (qt 0), so availability is qt > 0.
 */

import { resolveMediaUrl } from './mediaUrl';
import { shopifyBinaryInventoryPayload } from './fn6ItemFields';
import { IMPORT_STATUS } from './bulkImport';

export const DIAMOND_SKU_PREFIX = 'D-';

/**
 * Map a GWEB Dim.Fd2 response (diamond jewelry piece) to the field names
 * the dashboard uses. Fd2 = the piece (code, dis1, qt, karat `co`, gold
 * weight `go_21`, price = totus_dr_r x USD); fdn6_set = its stones (col,
 * cla, cut = shape, count, we = carat). Summary specs come from the
 * largest stone; carat is the total of all stones.
 */
export function normalizeGwebDiamond(data) {
  if (!data || !data.code) return null;
  const stones = (data.fdn6_set || []).map((s) => ({
    color: s.col || '',
    clarity: s.cla || '',
    shape: s.cut || '',
    count: Number(s.count) || 0,
    carat: Number(s.we) || 0,
  }));
  const main = stones.reduce((a, b) => (!a || b.carat > a.carat ? b : a), null);
  const totalCarat = stones.reduce((t, s) => t + s.carat, 0);
  const stoneCount = stones.reduce((t, s) => t + (s.count || 0), 0);
  const qty = Number(data.qt) || 0;
  return {
    id: data.id,
    zco: data.code,
    sku: `${DIAMOND_SKU_PREFIX}${data.code}`,
    zdis: data.dis1 || '',
    carat: totalCarat > 0 ? totalCarat : null,
    shape: main?.shape || '',
    color: main?.color || '',
    clarity: main?.clarity || '',
    cut: '',
    stones,
    stoneCount,
    karat: data.co ?? null,
    goldWeight: data.go_21 ?? null,
    qty,
    available: qty > 0,
    s_totus: data.totus_dr_r,
    price: data.price,
  };
}

export function isDiamondSku(sku) {
  return String(sku || '').trim().toUpperCase().startsWith(DIAMOND_SKU_PREFIX);
}

/** "D-1045" -> "1045"; a bare "1045" is returned unchanged. */
export function diamondZcoFromSku(sku) {
  const s = String(sku || '').trim();
  return isDiamondSku(s) ? s.slice(DIAMOND_SKU_PREFIX.length) : s;
}

export function diamondSku(item) {
  return item?.sku || `${DIAMOND_SKU_PREFIX}${item?.zco}`;
}

/** GWEB's price, to 2 decimals. Never rounded to 5 (client decision). */
export function resolveDiamondPrice(item) {
  const n = Number(item?.price);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function formatCarat(carat) {
  const n = Number(carat);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)}ct` : null;
}

export function diamondImageUrls(item) {
  const url = resolveMediaUrl(item?.stone_photo_url);
  return url ? [url] : [];
}

export function diamondTitle(item) {
  const name = String(item?.zdis || '').trim();
  if (name) return name;
  const carat = formatCarat(item?.carat);
  const shape = String(item?.shape || '').trim();
  return [carat, shape, 'Diamond'].filter(Boolean).join(' ') || `Diamond ${item?.zco}`;
}

const SPEC_ROWS = [
  ['Gold', (i) => (i.goldWeight ? `${Number(i.goldWeight).toFixed(2)} g${i.karat ? ` · ${i.karat}K` : ''}` : null)],
  ['Stones', (i) => (i.stoneCount ? String(i.stoneCount) : null)],
  ['Total carat', (i) => formatCarat(i.carat)],
  ['Shape', (i) => i.shape],
  ['Color', (i) => i.color],
  ['Clarity', (i) => i.clarity],
  ['Cut', (i) => i.cut],
  ['Polish', (i) => i.polish],
  ['Symmetry', (i) => i.symmetry],
  ['Fluorescence', (i) => i.fluor],
  ['Certificate', (i) => i.cer_no],
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function diamondBodyHtml(item) {
  const rows = SPEC_ROWS
    .map(([label, get]) => [label, get(item)])
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([label, v]) => `<tr><td><strong>${label}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  return rows ? `<table class="diamond-specs">${rows}</table>` : '';
}

/**
 * Variant metafields for a diamond. Same `custom` namespace as gold.
 * All single_line_text_field so no Shopify definition type can clash.
 * Accepts either a GWEB API item or a bulk-sync update entry.
 */
export function diamondMetafields(item) {
  const fields = [
    ['gweb_type', 'diamond'],
    ['gweb_carat', formatCarat(item?.carat)],
    ['gweb_stones', item?.stoneCount ? String(item.stoneCount) : null],
    ['gweb_shape', item?.shape],
    ['gweb_color', item?.color],
    ['gweb_clarity', item?.clarity],
    ['gweb_cut', item?.cut],
    ['gweb_cert', item?.cer_no],
  ];
  return fields
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([key, value]) => ({
      namespace: 'custom',
      key,
      type: 'single_line_text_field',
      value: String(value).trim(),
    }));
}

/** Same contract as classifyItem() for gold, so the run panel works unchanged. */
export function classifyDiamond(item, listedSkus) {
  const code = diamondSku(item);
  if (!item?.zco) {
    return { code: '', status: IMPORT_STATUS.INVALID, reason: 'Diamond has no code', photos: 0, warnings: [] };
  }
  if (listedSkus?.has(code)) {
    return { code, status: IMPORT_STATUS.LISTED, reason: 'Already on Shopify', photos: 0, warnings: [] };
  }
  if (item.available === false) {
    return { code, status: IMPORT_STATUS.INVALID, reason: 'Sold / out of stock in GWEB', photos: 0, warnings: [] };
  }
  const price = resolveDiamondPrice(item);
  const photos = diamondImageUrls(item).length;
  if (price == null) {
    return { code, status: IMPORT_STATUS.NO_PRICE, reason: 'GWEB has no selling price (s_totus)', photos, warnings: [] };
  }
  return { code, status: IMPORT_STATUS.READY, reason: '', price, photos, warnings: photos === 0 ? ['No photos'] : [] };
}

/** Publish body for publishProductToShopify() — the same path gold uses. */
export function buildDiamondPublishBody(item, defaults = {}) {
  const price = resolveDiamondPrice(item);
  const tags = Array.isArray(defaults.tags) ? defaults.tags.join(', ') : (defaults.tags || '');
  return {
    title: diamondTitle(item),
    body_html: diamondBodyHtml(item),
    product_type: defaults.productType || 'Diamond',
    price: price == null ? '' : price.toFixed(2),
    sku: diamondSku(item),
    images: diamondImageUrls(item).map((src) => ({ src })),
    vendor: defaults.vendor || 'Eleve',
    tags: tags ? `${tags}, diamond` : 'diamond',
    collectionIds: (defaults.collectionIds || []).map(Number).filter(Boolean),
    variantMetafields: diamondMetafields(item),
    ...shopifyBinaryInventoryPayload(true),
  };
}
