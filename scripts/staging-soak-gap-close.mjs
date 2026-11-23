/**
 * Light staging soak for gap-close verification (homepage + health + search RPC).
 * Does not stress payment/OTP.
 */
const STAGING_APP =
  process.env.STAGING_APP_URL || "https://sociva-integration.vercel.app";
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://wwuanzbusxoyzixuprxs.supabase.co";
const ANON =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

async function one(url, init) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, init);
    return { ok: res.ok || res.status < 500, ms: Date.now() - t0, status: res.status };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, status: 0, err: String(e) };
  }
}

async function wave(vus) {
  const jobs = [];
  for (let i = 0; i < vus; i++) {
    jobs.push(one(STAGING_APP + "/"));
    if (ANON) {
      jobs.push(
        one(`${SUPABASE_URL}/rest/v1/rpc/search_products_v2`, {
          method: "POST",
          headers: {
            apikey: ANON,
            Authorization: `Bearer ${ANON}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            _query: "",
            _limit: 5,
            _offset: 0,
          }),
        }),
      );
    }
  }
  const results = await Promise.all(jobs);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  return { vus, samples: results.length, ok, fail, p95_ms: p95 };
}

const waves = [];
for (const v of [50, 100, 200]) {
  waves.push(await wave(v));
}

const out = {
  at: new Date().toISOString(),
  tool: "node-concurrent-gap-close",
  waves,
  note: "Homepage + search_products_v2; rate limit wrapper must not 5xx under load",
};
console.log(JSON.stringify(out, null, 2));
await import("fs").then((fs) =>
  fs.writeFileSync("load/CAPACITY_STAGING_GAP_CLOSE.json", JSON.stringify(out, null, 2)),
);
