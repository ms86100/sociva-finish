# Unit 2 exit gate

## Shipped

- Commute profile upsert / soft-delete / pause (`cleaner_city_upsert_commute_profile`)
- Approved-domain-only work email OTP (edge `cleaner-city-work-email-otp` + store/verify RPCs)
- Personal/disposable domain blocklist
- `cleaner_city_require_verified_commuter` for later publish/book gates
- Setup UI at `/cleaner-city/setup`
- Admin domain approval in A Cleaner City admin tab
- Greenfield Phase-2 Tower H feature enabled in production

## Dependency

Work-email send requires `RESEND_API_KEY` (env) or vault key `resend_api_key`, optional `RESEND_FROM_EMAIL` / `resend_from_email`.

Without it, send returns `503` with `code: email_provider_missing` (no fake OTP delivery).

## Exit criteria

- Unverified users cannot pass `cleaner_city_require_verified_commuter`
- Gmail and similar personal domains rejected
- Only `company_domains.status = approved` accepted
- Changing email after verify requires re-verification
