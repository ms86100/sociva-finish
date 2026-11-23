#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const ref = process.argv[2] || "wwuanzbusxoyzixuprxs";

const raw = execFileSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["supabase", "projects", "api-keys", "--project-ref", ref, "-o", "json"],
  { encoding: "utf8" },
);

const start = raw.indexOf("[");
const end = raw.lastIndexOf("]");
if (start < 0 || end < 0) {
  console.error("API_KEYS_PARSE_FAIL");
  process.exit(1);
}

const keys = JSON.parse(raw.slice(start, end + 1));
const service = keys.find((k) => k.id === "service_role" || k.name === "service_role");
const anon = keys.find((k) => k.id === "anon" || k.name === "anon");

if (!service?.api_key) {
  console.error("NO_SERVICE_KEY");
  process.exit(1);
}

console.log("USING_KEY_TYPE=legacy_service_role");

fetch(`https://${ref}.supabase.co/functions/v1/health`, {
  headers: {
    Authorization: `Bearer ${service.api_key}`,
    apikey: anon?.api_key || service.api_key,
  },
})
  .then(async (res) => {
    const body = await res.json().catch(() => ({}));
    console.log("HTTP=" + res.status);
    console.log("body_keys=" + Object.keys(body).join(","));
    console.log("redis_configured=" + String(body.redis_configured));
    console.log("redis=" + String(body.redis));
    console.log("status=" + String(body.status));
    console.log("db=" + String(body.db));
    if (body.redis_error) console.log("redis_error=" + String(body.redis_error));
    if (body.message) console.log("message=" + String(body.message));
  })
  .catch((e) => {
    console.error("FETCH_FAIL=" + e.message);
    process.exit(1);
  });
