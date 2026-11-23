# Cleaner City - Phase 1 Production Acceptance Plan

**Date:** 2026-11-01 (IST evening)  
**Project:** `kkzkuyhgdvyecmxtmkpy`  
**Mode:** Release gate. No Phase 2. No new product features.

## What this gate will and will not do

| Will do | Will not do |
|---------|-------------|
| Read `supabase_migrations.schema_migrations` | Treat the privacy self-test or service role as resident proof |
| Compare live policies, index, and function flags to the repo file | Create real resident rides or send SOS alerts |
| Re-run `tsc` and the Cleaner City vitest files, labelled static | Invent meetup coordinates or OTP inbox proof |
| Record OTP failure already present in function logs | Claim device results without a device session |

Authenticated A/B/C resident sessions, concurrent booking, cancel/waitlist lifecycle, SOS fan-out, Autopilot cron races, and iOS/Android dogfood require controlled accounts and devices that were not available in this session. Those items are planned as **BLOCKED**, not passed.

## Test matrix (planned)

1. Migration identity: repo `20261102230000` vs production history  
2. Publication and circle RLS with three authenticated residents  
3. Concurrent double-book on two hosts, same date and direction  
4. Publication cancel, waitlist, block exclusion, seat release  
5. SOS fan-out counts vs `notification_queue`  
6. Real OTP send, wrong, expired, reuse, revoke vs Autopilot  
7. Autopilot duplicate cron / manual  
8. Device dogfood and Book/Orders/Contact/delivery smoke  
9. Greenfield `society_meetup_points` count; seed only with approved coordinates  

## Safety limits

- No service-role SELECT used as a stand-in for resident A/B/C.  
- No unsolicited emergency notifications.  
- No fabricated coordinates.
