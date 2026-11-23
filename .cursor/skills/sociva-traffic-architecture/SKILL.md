---
name: sociva-traffic-architecture
description: >-
  Enforces Sociva production traffic, rate-limit, edge, multi-tenant, and
  scalability architecture when building or changing APIs, Edge Functions,
  Postgres RPCs, Realtime, uploads, auth/OTP, payments, search, chat, or
  notifications. Use while implementing features - not as a full audit prompt.
  Prefer existing Vercel + Supabase + Upstash patterns; never invent nginx or
  weaken RLS/rate limits to ship.
---

# Sociva Traffic & Infrastructure Architecture

## Mission

When building or changing Sociva features, follow the **verified production architecture**. This is a build-time compliance skill, not an audit to re-run every turn.

Canonical evidence snapshot: `docs/audits/SOCIVA_TRAFFIC_MANAGEMENT_AND_SCALABILITY_AUDIT.md`  
Redis ops: `docs/REDIS-UPSTASH.md`

Do **not** open a new traffic audit report unless the user explicitly asks for an audit.

## Verified architecture (do not invent layers)

```text
Client (Web SPA / Capacitor / Electron)
  -> Vercel CDN / Edge / WAF  (static Vite + share OG routes)
  -> Supabase API Gateway     (Auth, PostgREST RPCs, Realtime, Storage, Edge Functions)
       -> Edge Functions      (CORS allowlist, Redis or Postgres rate limit)
       -> Postgres            (RLS, SECURITY DEFINER RPCs, rate_limits, queues)
       -> Upstash Redis REST  (distributed RL counters; not general app cache by default)
```

Accepted truths:

- Main reverse proxy is **platform-managed** (Vercel + Supabase). Do not add custom nginx/Caddy for the primary app unless the user explicitly requires it.
- Browser/clients talk to **Supabase directly** for Auth/RPC/Realtime. That dual entry is intentional, not a missing nginx bug.
- Frontend SPA scaling is not the same as Postgres/Realtime capacity. Never claim horizontal scale from CDN alone.

## Environment safety

| Env | Supabase ref | Rule |
|---|---|---|
| Staging | `wwuanzbusxoyzixuprxs` | Default for migrations, seeds, RL experiments |
| Production | `kkzkuyhgdvyecmxtmkpy` | Explicit user authorization only |

- Never point staging builds at production credentials.
- Never weaken RLS, webhook auth, upload MIME/size caps, or payment controls to make a feature "work".
- Never expose secrets, service-role keys, OTP codes, or tokens in docs/chat/commits.

## Non-negotiable build rules

### 1. Rate limiting (required for abuse-prone paths)

Use existing shared helpers - do not invent a new limiter per feature.

| Layer | Use when | Implementation |
|---|---|---|
| Edge Functions | OTP, payments, admin, notification senders, expensive HTTP | `supabase/functions/_shared/rate-limiter.ts` (`checkRateLimit`, `rateLimitResponse`) |
| Postgres RPCs | Search, browse, expensive SECURITY DEFINER reads/writes | `public.sociva_assert_rate_limit(key, max, window_seconds)` |
| DB triggers | Chat spam, society notification fair-use | Existing trigger patterns (do not bypass) |

**Fail-closed** for OTP and payment paths (`RATE_LIMIT_FAIL_CLOSED` / `failClosed: true`). Prefer Redis (Upstash REST) with Postgres `rate_limits` fallback.

Responses must include **HTTP 429** and **Retry-After** when using Edge helpers.

Keys should include identity scope: `user:`, `ip:`, `society:`, or operation name. Prefer user/account limits for authenticated abuse; IP for anonymous/OTP.

#### CRITICAL: PostgREST volatility

Any RPC that calls `sociva_assert_rate_limit` (writes / `FOR UPDATE`) **must be `VOLATILE`**.

PostgREST runs `STABLE` / `IMMUTABLE` RPCs in a **read-only** transaction. That yields:

`cannot execute SELECT FOR UPDATE in a read-only transaction`

and the app shows **"Couldn't load the marketplace"** (or similar load failures).

Checklist for new/changed search/browse RPCs:

1. Call `sociva_assert_rate_limit(...)` early.
2. Mark the **wrapper** `LANGUAGE plpgsql VOLATILE SECURITY DEFINER`.
3. Keep heavy read logic in a `_core` helper if useful; the public wrapper that rates-limits must still be VOLATILE.
4. Grant execute only to intended roles (`anon` / `authenticated` / `service_role` as appropriate).
5. Verify with a PostgREST/anon client call, not only `execute_sql` as superuser.

Known wrapped search/browse RPCs that must stay VOLATILE:

- `search_sellers_paginated`
- `search_products_v2`
- `get_products_for_sellers`
- `search_products_fts`
- `get_society_search_suggestions`

### 2. Abuse surfaces that always need protection

When adding or changing any of these, include rate limits (and authz) in the same PR:

| Operation | Minimum control |
|---|---|
| Login / password reset | Platform Auth + avoid custom unthrottled loops |
| OTP send / verify | Edge RL, fail-closed, IP + phone/user key |
| Registration | Auth provider + no open service-role signup helpers |
| Search / marketplace browse | RPC `sociva_assert_rate_limit` + VOLATILE wrapper |
| Chat / Smart Groups messages | Existing chat RL triggers; do not open unscoped inserts |
| Group / society creation | Authz + admin/society gates |
| File uploads | Storage bucket MIME + size caps; no public write without RLS |
| Notifications | Queue + society fair-use; never blast without prefs/audience rules |
| Payments | Idempotency keys + Edge RL + sandbox/test discipline |
| Expensive DEFINER RPCs | Rate limit + revoke from `PUBLIC`/`anon` unless required |

If a path has **no** meaningful protection, do not ship it to production.

### 3. Edge Functions

- CORS: allowlist only. Never reintroduce `Access-Control-Allow-Origin: *` on authenticated or privileged functions.
- Validate JWT / service-role usage explicitly. Prefer least privilege.
- Use shared rate limiter; return `rateLimitResponse` on deny.
- Keep functions **stateless**. No in-memory singleton that breaks multi-isolate.
- Timeouts and body size: respect platform limits; reject oversized payloads early.

### 4. Multi-tenant (society) isolation

Sociva is multi-society. Every feature must assume noisy-neighbour risk.

- Enforce society isolation with **RLS** and society-scoped RPCs. Never "fix" by disabling RLS.
- Prefer `get_user_society_id` / membership checks over trusting client `society_id`.
- Cross-society reads/writes must fail at the backend.
- Tenant traffic: respect society notification fair-use and chat RL; do not add unbounded fan-out per society.
- One busy society must not be able to spam queues/notifications for everyone.

### 5. Caching

- Default: **no new general Redis cache** unless measured hot QPS justifies it.
- Redis today is for **rate-limit counters** (Upstash REST). Do not require Redis to boot the app.
- SPA: React Query stale times are fine for UX; they are not a substitute for API abuse controls.
- HTTP caching: prefer existing Vercel/static Cache-Control; do not cache authenticated personalized HTML aggressively.
- Any new cache needs TTL + invalidation story and must not leak cross-society data.

### 6. Database & connections

- Prefer pooled/serverless PostgREST access patterns. Avoid long-lived unbounded connection openers from Edge.
- Add covering indexes for new foreign keys and hot filters (advisor-driven).
- Wrap RLS policies to avoid initplan traps (`(select auth.uid())` patterns already used in repo).
- SECURITY DEFINER: pin `search_path`, revoke from `PUBLIC`, grant narrowly.
- Production `max_connections` is a platform ceiling (~60 historically). Do not design features that fan out N DB connections per user action.
- Never claim readiness for 10k+ concurrent without plan capacity evidence.

### 7. Realtime

- Channel names must be society/user scoped; rely on RLS for payloads.
- Do not open world-readable realtime topics.
- Avoid subscribe storms (one channel per row). Batch or use existing patterns.
- Large Realtime soak tests are plan-limited; do not run destructive load tests on production.

### 8. Background jobs & queues

- Use existing queues (`notification_queue`, claim RPCs, pg_cron / Edge cron) with idempotent handlers.
- Workers must tolerate at-least-once delivery (dedupe by id / idempotency key).
- Cron Edge endpoints need auth (service key / shared secret). Never leave open HTTP triggers.
- Multiple workers must not double-send; use claim/lease patterns already in repo.

### 9. Security headers & edge config

- Preserve `vercel.json` security headers (CSP/HSTS as configured). Do not strip them.
- Trusted client IP extraction: use platform-forwarded headers via existing helpers; do not trust raw spoofable headers alone for fail-closed OTP.
- Uploads: keep bucket MIME/size limits; virus scan remains deferred unless user requests vendor AV.

### 10. Horizontal scale mindset

Assume many Edge isolates and CDN POPs:

- Stateless request handlers only.
- Shared state in Postgres/Redis/Storage - not process memory.
- No sticky-session requirement for SPA/API.
- Health: keep `health` / `ops-alert-check` meaningful when adding dependencies.

## Feature build checklist (copy into PR notes)

Before claiming a backend/feature done:

- [ ] Abuse path identified (auth, OTP, search, chat, upload, pay, notify, DEFINER RPC)
- [ ] Rate limit added at correct layer (Edge and/or `sociva_assert_rate_limit`)
- [ ] If RPC rates-limits: function is **VOLATILE**; verified via PostgREST/anon or authenticated client
- [ ] RLS / society membership enforced; no cross-tenant leak
- [ ] CORS allowlist intact for Edge changes
- [ ] Uploads capped (MIME/size) if media involved
- [ ] Payments: idempotency + fail-closed RL; no fabricated paid gateway success
- [ ] Queues/cron authenticated and idempotent
- [ ] Staging verified before production; production only with explicit auth
- [ ] No secrets in logs, migrations comments, or docs

## What not to do

- Do not rewrite architecture around custom nginx "because audits mention reverse proxies".
- Do not treat CDN scale as DB/Realtime scale.
- Do not mark STABLE any RPC that writes rate-limit state.
- Do not add Redis as a hard dependency for ordinary reads.
- Do not globally enable features for all societies when piloting.
- Do not disable RLS, rate limits, or upload caps to unblock UI.
- Do not run production load tests or destructive soaks unless explicitly authorized.

## Progressive detail

- Endpoint / limit reference: [reference.md](reference.md)
- Live audit snapshot (read-only context): `docs/audits/SOCIVA_TRAFFIC_MANAGEMENT_AND_SCALABILITY_AUDIT.md`
