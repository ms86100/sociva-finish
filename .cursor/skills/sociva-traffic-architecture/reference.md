# Sociva traffic architecture - reference

Companion to `SKILL.md`. Use when implementing a specific surface.

## Shared code map

| Concern | Location |
|---|---|
| Edge rate limiter (Redis + Postgres) | `supabase/functions/_shared/rate-limiter.ts` |
| Edge CORS helpers | `supabase/functions/_shared/` (CORS allowlist patterns in function `index.ts` files) |
| Postgres rate limit | `public.sociva_assert_rate_limit` + table `rate_limits` |
| Marketplace / search wrappers | Migrations wrapping `search_*` / `get_products_for_sellers` |
| VOLATILE fix for PostgREST | `supabase/migrations/20261123240000_fix_marketplace_rpc_volatile_for_rate_limit.sql` |
| Redis setup | `docs/REDIS-UPSTASH.md` |
| Vercel headers / CSP | `vercel.json` |
| Staging assert | `scripts/assert-supabase-env.cjs` |

## Suggested limit classes (tune, do not invent parallel systems)

| Class | Typical budget | Notes |
|---|---|---|
| OTP send/verify | Tight IP + identifier; fail-closed | Abuse burns SMS cost |
| Payment create/confirm | Tight per user; idempotent | Duplicate charges risk |
| Admin Edge | Moderate per admin user | |
| Search / browse RPC | ~120 / 60s per user or anon bucket | Must stay VOLATILE |
| Chat messages | Trigger ~60 / 10 min style | Do not bypass triggers |
| Society notification enqueue | Fair-use per society (hundreds / 10 min class) | Noisy neighbour |

Exact numbers live in migrations/Edge code - match neighbors when adding a sibling endpoint.

## RPC wrapper template

```sql
CREATE OR REPLACE FUNCTION public.my_feature_rpc(...)
RETURNS ...
LANGUAGE plpgsql
VOLATILE          -- required if calling sociva_assert_rate_limit
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sociva_assert_rate_limit(
    'my_feature:' || coalesce(auth.uid()::text, 'anon'),
    120,
    60
  );
  -- authz + work
END;
$$;

REVOKE ALL ON FUNCTION public.my_feature_rpc(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_feature_rpc(...) TO authenticated; -- add anon only if needed
```

## Edge Function template notes

1. Import `checkRateLimit` / `rateLimitResponse` from `_shared/rate-limiter.ts`.
2. Resolve key from user id and/or trusted IP helper.
3. On deny: return `rateLimitResponse(...)` (includes Retry-After).
4. OTP/pay: `failClosed: true`.
5. Keep CORS allowlist; never `*`.

## Verification commands (safe)

```bash
# Confirm staging env only
node scripts/assert-supabase-env.cjs --require-staging

# After RPC rate-limit changes: call via anon/authenticated Supabase JS
# (superuser SQL alone does not prove PostgREST read-only behavior)
```

## Capacity honesty

| Claim | Allowed when |
|---|---|
| CDN/SPA scales | Always (platform) |
| Edge Functions scale out | Stateless + external RL store |
| DB handles N concurrent | Only with measured pool/`max_connections` headroom |
| Realtime handles N | Only with subscribe harness evidence |

Do not invent concurrent-user capacity numbers in feature PRs.
