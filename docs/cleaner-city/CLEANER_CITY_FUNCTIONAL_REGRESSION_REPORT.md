# Cleaner City - functional regression report

Date: 2026-11-01. No physical device. No resident login in the browser.

## Executed

| Check | Result | Evidence |
| --- | --- | --- |
| Production function catalog | Pass | `pg_proc` list includes `cleaner_city_repeat_last_commute` with zero arguments and authenticated execute |
| Repeat ACL | Pass | `proacl` is postgres owner plus authenticated execute |
| Schema reload | Sent, not retested by a tap | `NOTIFY pgrst, 'reload schema'` |
| Newer tables | Recorded | chat, stops, fuel, badges are absent. Alerts, seat offers, circle invites exist. Meetup count 0. `resend_from_email` is set |
| Edge functions | Recorded | Only `cleaner-city-work-email-otp` among Cleaner City functions is ACTIVE |
| Cron | Recorded | autopilot `15 20 * * *`, reminders hourly, timeouts every 15 minutes, all active |
| Typecheck | Pass | `npx tsc --noEmit` after the impact card and the repeat retry |

## Not executed

| Check | Why it is blocked or skipped |
| --- | --- |
| Tap Repeat last commute after the reload | Needs the resident session that showed the toast |
| Work-email inbox | Needs a human mailbox check |
| Resident RLS A/B/C | No controlled resident JWTs |
| Concurrent double-book on production | Not run. Local PostgreSQL proof is older and is not production |
| Cancel, waitlist, SOS, OTP | Not run |
| Android locked screen and Maps | No device |
| iOS background location | Not implemented, on purpose |
| Book, Orders, Contact, delivery regression | Those screens were not edited in this pass and were not opened |
| Browser click-through of the new impact card | No browser session was driven |

## Failed

The resident tap of Repeat last commute failed before the schema reload, with PGRST202. That failure is the bug this pass targeted. It is not yet shown as passed.

## How to verify the fix

1. Open A Cleaner City while logged in as the same resident.
2. Tap Repeat last commute once.
3. Pass: Offer opens with a tomorrow draft, or the ride page opens, or the page says tomorrow already has a commute.
4. Fail: the schema-cache toast appears again. Then reload the API schema from the Supabase dashboard and tap once more.
