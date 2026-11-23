# Cleaner City - final product readiness

Updated: 2026-11-01 after production apply of migrations `20261102233000` through `20261102260000` (via chunked `apply_migration`) and edge deploy of dispatch + fuel functions.

## Decision

**Controlled developer / internal dogfood: yes, with known gaps.**

**Resident pilot: no-go until the blockers below are cleared.**

**Public launch: no-go.**

## What is live in production now

- Booking lock, waitlist seat holds, repeat last commute, WFH, draft refresh, polyline overlap helper, contact verification RPCs, SOS SMS queue table, masked-call queue RPC, chat tables, badges table, fuel payment tables, up to 5 office stops, city discovery prefs, direct messages, WhatsApp alert channel, fuel settle RPC.
- Edge: `cleaner-city-work-email-otp`, `cleaner-city-dispatch-alerts`, `cleaner-city-fuel-order` v2, `cleaner-city-confirm-fuel` v1, `cleaner-city-settle-fuel` v1.
- Config present: `resend_from_email`, Razorpay key id/secret, WhatsApp token and phone number id.
- Autopilot / reminders / timeouts crons remain active.

## What still blocks a resident pilot

1. **Meetup coordinates:** `society_meetup_points` count is **0**. Do not invent them. Admin must enter real Greenfield gate/clubhouse pins.
2. **SOS SMS:** No `msg91_auth_key` / `msg91_sos_template_id` in `admin_settings`. Dispatcher is deployed but SMS will return `sms_provider_not_configured`. WhatsApp fallback can run if the alert path reaches it.
3. **Relay calls:** No Twilio sid / token / from-number. Masked call queues a row but cannot place a call.
4. **Resident JWT RLS A/B/C:** Still not executed with controlled host/peer/outsider sessions.
5. **Lifecycle dogfood:** Cancel, waitlist hold, OTP start/complete, and SOS were not executed on real accounts in this pass.
6. **Device dogfood:** Android foreground commute tracking needs a new build and a locked-screen test. iOS will not background-locate.
7. **Repeat last commute:** Function is live; PostgREST schema was reloaded. A resident tap after the reload was not observed in this pass.

## Honest product limits (still true when the above are fixed)

- Matching may use a saved host polyline when present; otherwise distance/detour. SQL does not call live Google Directions.
- Fuel guest checkout can run when Razorpay keys work. Host bank transfer needs a linked Razorpay **route** `acct_` and a successful transfer status.
- Emissions are not shown. Completed shared rides are counted only.
- Onboarding Sociva credit stays **500**. No commute credit reward is configured.

## Go / no-go

| Gate | Verdict |
| --- | --- |
| Internal dogfood of setup, pin, schedule, publish, find, request | Go, with SOS honesty |
| Controlled resident pilot | **No-go** |
| Public launch | **No-go** |
