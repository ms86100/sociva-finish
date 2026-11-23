# Upstash Redis for Sociva Edge Functions

Sociva Edge Functions (Deno) support **Upstash Redis REST** for distributed rate limiting. There is no TCP Redis client in this repo - REST is required for Supabase Edge isolates.

## Status (staging)

| Item | Reality |
|---|---|
| Frontend SPA | Does not use Redis |
| Vercel Marketplace | **Provisioned** on `sociva-integration` as `sociva-staging-redis` (Upstash free, region `hnd1`) |
| Staging credentials | Stored in `admin_settings` / vault keys `upstash_redis_rest_url` + `upstash_redis_rest_token` |
| Edge rate limiter | Prefers Redis (env or vault); otherwise Postgres `rate_limits` |
| Required to boot | **No** - Postgres fallback remains |
| Health check | Staging `health` (service-role) reports `redis_configured` / `redis` |

## Create an Upstash database

1. Create a Redis database in [Upstash](https://upstash.com/) (or Vercel Marketplace Upstash).
2. Copy **REST URL** and **REST TOKEN** (not the Redis TCP URL).
3. Prefer a region close to Supabase (`ap-northeast-2` for current projects).

## Staging setup (already done)

1. Vercel project `sociva-integration` has Marketplace resource `sociva-staging-redis`.
2. REST URL/token were mirrored into staging Supabase `admin_settings` + vault as:
   - `upstash_redis_rest_url`
   - `upstash_redis_rest_token`
3. Staging Edge secrets include `UPSTASH_REDIS_REST_*`, `KV_REST_API_*`, and `RATE_LIMIT_FAIL_CLOSED=true`.
4. Staging `health` detail view (authorized via platform service key or `HEALTH_DETAIL_SECRET`) reports `redis_configured=true` / `redis=ok`.
5. Redeployed with Redis rate limiter: `msg91-send-otp`, `msg91-verify-otp`, `create-razorpay-order`, `create-seller-credit-order`, `confirm-seller-credit-payment`, `health`.

Optional Deno.env secrets (if you prefer env over vault):

```bash
npx supabase login
npx supabase secrets set \
  UPSTASH_REDIS_REST_URL="..." \
  UPSTASH_REDIS_REST_TOKEN="..." \
  RATE_LIMIT_FAIL_CLOSED="true" \
  --project-ref wwuanzbusxoyzixuprxs
```

Redeploy functions that import `_shared/rate-limiter.ts` so they pick up the Redis-aware limiter (OTP, Razorpay, etc.):

```bash
npx supabase functions deploy msg91-send-otp msg91-verify-otp create-razorpay-order \
  --project-ref wwuanzbusxoyzixuprxs
```

## Behaviour

1. If `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set → fixed-window `INCR` + `EXPIRE NX`.
2. Else or on Redis error → Postgres `public.rate_limits`.
3. If both fail:
   - OTP / Razorpay order paths use `{ failClosed: true }` (deny).
   - Other callers: deny only when `RATE_LIMIT_FAIL_CLOSED=true`, otherwise allow (legacy).
4. HTTP 429 responses include `Retry-After` and `retry_after_seconds`.

## Verify

Service-role call to `health` should include:

```json
{
  "redis_configured": true,
  "redis": "ok"
}
```

If secrets are missing: `"redis": "not_configured"` (still healthy). If secrets are wrong: `"redis": "error"` (degraded for service-role health).

## Code

- [`supabase/functions/_shared/redis.ts`](../supabase/functions/_shared/redis.ts)
- [`supabase/functions/_shared/rate-limiter.ts`](../supabase/functions/_shared/rate-limiter.ts)
