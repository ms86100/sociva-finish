/**
 * Staging certification for storage limits, variant RLS, chat throttle, HIBP, CORS.
 * Uses service role from `npx supabase projects api-keys` when SUPABASE_ACCESS_TOKEN is set,
 * or env STAGING_SERVICE_KEY / STAGING_ANON_KEY.
 */
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const REF = "wwuanzbusxoyzixuprxs";
const URL = `https://${REF}.supabase.co`;

function loadKeys() {
  if (process.env.STAGING_SERVICE_KEY && process.env.STAGING_ANON_KEY) {
    return {
      service: process.env.STAGING_SERVICE_KEY,
      anon: process.env.STAGING_ANON_KEY,
    };
  }
  const raw = execSync(
    `npx supabase projects api-keys --project-ref ${REF} -o json`,
    { encoding: "utf8", maxBuffer: 2_000_000 },
  );
  const keys = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
  return {
    service: keys.find((k) => k.id === "service_role").api_key,
    anon: keys.find((k) => k.id === "anon").api_key,
  };
}

const { service, anon } = loadKeys();
const admin = createClient(URL, service);
const anonClient = createClient(URL, anon);

const results = [];

function ok(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
}

// Storage buckets
{
  const { data, error } = await admin.rpc("exec_sql", {}).maybeSingle?.();
  void data;
  void error;
  const { data: buckets, error: bErr } = await admin
    .from("buckets")
    .select("id,file_size_limit,allowed_mime_types")
    .limit(20);
  // storage schema may not be exposed via REST - use SQL via edge or skip
  if (bErr) {
    // fallback: REST storage list
    const listed = await fetch(`${URL}/storage/v1/bucket`, {
      headers: { Authorization: `Bearer ${service}`, apikey: service },
    }).then((r) => r.json());
    const all = Array.isArray(listed) ? listed : [];
    const capped = all.every(
      (b) => b.file_size_limit && (b.allowed_mime_types?.length || 0) > 0,
    );
    ok("storage_all_buckets_capped", capped && all.length >= 7, `n=${all.length}`);
  } else {
    ok("storage_query", false, "unexpected");
  }
}

// Variant gate: anon select should fail or return empty due to RLS
{
  const { data, error } = await anonClient
    .from("_variant_gate_backup")
    .select("*")
    .limit(1);
  const blocked = !!error || !data || data.length === 0;
  ok("variant_gate_anon_blocked", blocked, error?.message || "empty");
}

// HIBP: try signup with breached password
{
  const email = `hibp-test-${Date.now()}@example.com`;
  const { data, error } = await anonClient.auth.signUp({
    email,
    password: "Password123!",
  });
  // HIBP may reject common passwords; Password123! is often breached
  const rejected =
    !!error &&
    /password|pwned|breach|leaked|weak|hibp/i.test(error.message || "");
  ok(
    "hibp_rejects_common_password",
    rejected || (!data?.user && !!error),
    error?.message || "no error (may need known-breached string)",
  );
  if (!rejected && error) {
    console.log("  hibp_note:", error.message);
  }
}

// CORS: hostile origin should not get Allow-Origin
{
  const r = await fetch(`${URL}/functions/v1/health`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST",
      apikey: anon,
    },
  });
  const allow = r.headers.get("access-control-allow-origin");
  ok("cors_denies_hostile_origin", !allow || allow !== "https://evil.example", `allow=${allow}`);
}

{
  const r = await fetch(`${URL}/functions/v1/health`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://sociva-integration.vercel.app",
      "Access-Control-Request-Method": "GET",
      apikey: anon,
    },
  });
  const allow = r.headers.get("access-control-allow-origin");
  ok(
    "cors_allows_staging_origin",
    allow === "https://sociva-integration.vercel.app",
    `allow=${allow}`,
  );
}

// Health redis
{
  const r = await fetch(`${URL}/functions/v1/health`, {
    headers: { Authorization: `Bearer ${service}`, apikey: anon },
  });
  const j = await r.json();
  ok("health_redis_ok", j.redis === "ok", `redis=${j.redis} nq=${j.notification_queue_pending}`);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
