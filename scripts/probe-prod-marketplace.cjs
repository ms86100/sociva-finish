const { createClient } = require('@supabase/supabase-js');

const url = 'https://kkzkuyhgdvyecmxtmkpy.supabase.co';
const anon = process.env.PROD_ANON_KEY;
if (!anon) {
  console.error('Set PROD_ANON_KEY');
  process.exit(2);
}

(async () => {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  // Approximate Greenfield / society cluster used by production sellers
  const lat = 12.905;
  const lng = 77.65;
  const { data: sellers, error: sErr } = await sb.rpc('search_sellers_paginated', {
    _lat: lat,
    _lng: lng,
    _radius_km: 15,
    _limit: 10,
    _offset: 0,
  });
  console.log('sellers', sErr ? `ERR ${sErr.message}` : `ok ${(sellers || []).length}`);
  if (sErr) process.exit(1);
  if (!sellers?.length) {
    console.log('no sellers in radius - not an RPC crash');
    process.exit(0);
  }
  const { data: products, error: pErr } = await sb.rpc('get_products_for_sellers', {
    _seller_ids: sellers.slice(0, 5).map((s) => s.seller_id),
    _category: null,
    _limit: 40,
    _offset: 0,
    _lat: lat,
    _lng: lng,
  });
  console.log('products', pErr ? `ERR ${pErr.message}` : `ok ${(products || []).length}`);
  const homeFood = (products || []).filter((p) => p.category === 'home_food');
  console.log('home_food', homeFood.length, homeFood.slice(0, 3).map((p) => p.product_name));
  if (pErr) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
