#!/usr/bin/env node
"use strict";

const secret = process.env.SOCIVA_STAGING_SECRET || process.argv[2] || "";
if (!secret) {
  console.error("MISSING_SECRET");
  process.exit(1);
}

const url = "https://wwuanzbusxoyzixuprxs.supabase.co/functions/v1/health";

fetch(url, {
  headers: {
    Authorization: `Bearer ${secret}`,
    apikey: secret,
  },
})
  .then(async (res) => {
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      console.log("STATUS=" + res.status);
      console.log("BODY_PREFIX=" + text.slice(0, 200));
      process.exit(1);
    }
    console.log("HTTP=" + res.status);
    console.log("redis_configured=" + String(body.redis_configured));
    console.log("redis=" + String(body.redis));
    console.log("status=" + String(body.status));
    console.log("db=" + String(body.db));
    if (body.redis_error) console.log("redis_error=" + String(body.redis_error));
  })
  .catch((e) => {
    console.error("FETCH_FAIL=" + e.message);
    process.exit(1);
  });
