# Staging rollback (Vercel + Edge Functions)

Use this when a staging deploy misbehaves and you need the last known-good build quickly.

## Vercel (web app)

1. Open the Vercel project for staging (`sociva-integration` or linked preview).
2. **Deployments** - pick the last green deployment before the bad release.
3. **Promote to Production** (or redeploy that commit) for the staging alias.
4. Confirm `https://sociva-integration.vercel.app` loads and critical flows (login, browse) work.

CLI alternative (replace deployment URL):

```bash
vercel rollback <deployment-url-or-id> --yes
```

## Supabase Edge Functions

1. Identify the last good git commit for `supabase/functions/`.
2. Redeploy affected functions from that commit:

```bash
supabase functions deploy health
supabase functions deploy msg91-send-otp
supabase functions deploy msg91-verify-otp
supabase functions deploy create-razorpay-order
supabase functions deploy confirm-razorpay-payment
```

3. Smoke check:

```bash
curl -s "https://wwuanzbusxoyzixuprxs.supabase.co/functions/v1/health"
```

## When to roll back both

- CORS or CSP changes block the app in the browser: roll back Vercel first, then Edge if function responses are wrong.
- Payment or OTP regressions: roll back the specific Edge functions first, then Vercel if the client bundle changed.

## After rollback

- Note incident time, bad deployment id, and restored deployment id in your runbook or Linear issue.
- Reproduce the failure on a branch before re-shipping.