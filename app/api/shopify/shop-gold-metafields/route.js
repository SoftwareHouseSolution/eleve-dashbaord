import { NextResponse } from 'next/server';
import { getShopifyToken } from '../../../../lib/shopify';
import { getPublicApiBaseUrl } from '../../../../lib/publicEnv';
import { SUPPORTED_KARATS } from '../../../../lib/fn6Price';
import { repriceListedDiamonds } from '../../../../lib/diamondReprice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const METAFIELDS_SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key namespace value }
      userErrors { field message }
    }
  }
`;

const API_VERSION = '2024-10';

export async function GET() {
  let token, domain;
  try {
    const creds = await getShopifyToken();
    token = creds.token;
    domain = creds.domain;
  } catch (err) {
    return NextResponse.json({ error: 'Shopify credentials not configured' }, { status: 500 });
  }

  const base = getPublicApiBaseUrl();

  // One shop metafield per karat Eleve sells. KingGold wrote only gweb_pr18
  // because that store is 18K-only; a 21K or 24K line would be charged at
  // the 18K rate here if we copied that.
  const karatRates = {};
  let usdRate, updatedAt;
  try {
    const rateRes = await fetch(`${base}/Sup/api/gold-rate/`, { cache: 'no-store' });
    if (!rateRes.ok) throw new Error(`Gold-rate fetch failed: ${rateRes.status}`);
    const data = await rateRes.json();
    usdRate = Number(data.dollar) || 1;
    updatedAt = data.updated_at || new Date().toISOString();
    for (const karat of SUPPORTED_KARATS) {
      const value = Number(data[`pr${karat}`]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid pr${karat} value`);
      }
      karatRates[`pr${karat}`] = value;
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  try {
    const gqlRes = await fetch(
      `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({
          query: METAFIELDS_SET_MUTATION,
          variables: {
            metafields: [
              ...SUPPORTED_KARATS.map((karat) => ({
                ownerType: 'SHOP',
                namespace: 'custom',
                key: `gweb_pr${karat}`,
                type: 'number_decimal',
                value: String(karatRates[`pr${karat}`]),
              })),
              {
                ownerType: 'SHOP',
                namespace: 'custom',
                key: 'gweb_usd_rate',
                type: 'number_decimal',
                value: String(usdRate),
              },
            ],
          },
        }),
      },
    );
    const result = await gqlRes.json();
    const errors = result?.data?.metafieldsSet?.userErrors;
    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // GWEB calls this route on every gold AND dollar rate change, so it is
  // also where diamonds get repriced (their price = s_totus x USD). Started
  // in the background and not awaited: GWEB waits only 10s for this call,
  // and the dashboard runs as a long-lived Node server on Dokploy, so the
  // job keeps going after the response is sent.
  repriceListedDiamonds().catch((err) => console.error('[diamond-reprice] failed:', err));

  return NextResponse.json({ ok: true, ...karatRates, usd_rate: usdRate, updated_at: updatedAt, diamondReprice: 'started' });
}
