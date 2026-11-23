const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(path) {
  if (!fs.existsSync(path)) return {};
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function probe(label, url, key) {
  if (!url || !key) {
    console.log(label, 'missing credentials');
    return;
  }
  console.log(label, 'host', url);
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('search_sellers_paginated', {
    _lat: 12.9716,
    _lng: 77.5946,
    _radius_km: 15,
    _limit: 5,
    _offset: 0,
  });
  console.log(label, 'sellers', error ? `ERR ${error.message}` : `ok ${(data || []).length}`);
  if (error || !data?.[0]) return;
  const { data: products, error: pErr } = await sb.rpc('get_products_for_sellers', {
    _seller_ids: [data[0].seller_id],
    _category: null,
    _limit: 10,
    _offset: 0,
    _lat: 12.9716,
    _lng: 77.5946,
  });
  console.log(label, 'products', pErr ? `ERR ${pErr.message}` : `ok ${(products || []).length}`);
}

(async () => {
  const local = loadEnv('.env.local');
  const staging = loadEnv('.env.staging');
  await probe('local', local.VITE_SUPABASE_URL, local.VITE_SUPABASE_PUBLISHABLE_KEY);
  await probe('staging-file', staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_PUBLISHABLE_KEY);
  // Production anon via public REST discovery is not in repo; skip unless provided.
  if (process.env.PROD_SUPABASE_URL && process.env.PROD_SUPABASE_ANON) {
    await probe('prod-env', process.env.PROD_SUPABASE_URL, process.env.PROD_SUPABASE_ANON);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
