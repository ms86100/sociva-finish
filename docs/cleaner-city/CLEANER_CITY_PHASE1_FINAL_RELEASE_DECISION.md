# Cleaner City - Phase 1 Final Release Decision

**Date:** 2026-11-01  
**Project:** `kkzkuyhgdvyecmxtmkpy`

# NOT READY FOR PILOT

Phase 1 SQL is present in production as chunked migrations, and the catalog policies match the intended privacy shape. That is not acceptance. The resident tests that decide a pilot were not executed, OTP delivery failed, and the double-book guard is not concurrency-safe on paper.

---

## Scoreboard

| Area | Status |
|------|--------|
| Repo version `20261102230000` recorded in `schema_migrations` | FAIL (not recorded; applied as 2026110114* chunks) |
| Live publication and circle policies match intended SQL | PASS (catalog inspection only) |
| Privacy self-test | PASS as a privileged catalog check only |
| Resident A/B/C RLS penetration | BLOCKED |
| `cleaner_city_find_matches` output before/after confirm | BLOCKED |
| Concurrent double-book | NOT RUN; race is STATIC ONLY and still a blocker |
| Cancel, waitlist, no-show, overbook | NOT RUN |
| SOS fan-out vs notification rows | NOT RUN |
| OTP delivered to inbox | FAIL (Resend 403, no `resend_from_email`) |
| Wrong / expired / reused OTP and Autopilot after revoke | NOT RUN |
| Autopilot double cron | NOT RUN |
| iOS / Android dogfood | BLOCKED |
| Book, Orders, Contact, delivery regression | NOT RUN |
| Greenfield meetup points | FAIL to be ready: count is 0; not seeded (no approved coordinates) |
| `tsc --noEmit` | PASS (static) |
| Vitest Cleaner City subset 87 tests | PASS (STATIC ONLY) |

---

## Blockers (not folded into a vague limitations list)

### B1. Work-email OTP does not reach company inboxes

1. **Screen:** Set up commute, Step 2, Send verification code.  
2. **Code:** `supabase/functions/cleaner-city-work-email-otp/index.ts` (`getCredential` `resend_from_email`, fallback `Sociva <onboarding@resend.dev>`, `mapResendError`). Storage: `admin_settings` key `resend_api_key` only.  
3. **Root cause:** Resend account is still in test-sender mode. `resend_from_email` is unset.  
4. **User impact:** A resident with an approved company domain cannot verify, so they cannot complete setup or rely on Autopilot.  
5. **Reproduce:** Send a code to `support@sociva.in`.  
6. **Evidence:** Log `2026-11-01T14:27:53.928Z`, Resend 403, function HTTP 502.  
7. **Correction:** Verify a sending domain in Resend and set `resend_from_email` to an address on that domain.  
8. **Regression:** Send, receive, correct OTP, wrong OTP, expired OTP, reuse, then revoke and confirm `cleaner_city_autopilot_run` skips that user.

### B2. Publication and circle privacy not proven with resident sessions

1. **Screen:** Any discovery or circle screen; also direct REST.  
2. **Policy:** `commute_publications_select`, `commute_circles_read`.  
3. **Root cause:** Acceptance never authenticated as host, peer, and outsider.  
4. **User impact:** A policy typo or an RPC leak would still expose home/office pins or invite codes.  
5. **Reproduce:** As B, `select=origin_latitude,origin_longitude,destination_latitude,destination_longitude` on `commute_publications`. As a non-member, `select=invite_code` on `commute_circles`.  
6. **Evidence:** This gate recorded BLOCKED. Self-test JSON is not a substitute.  
7. **Correction:** Run the A/B/C script and attach raw responses (row counts, not other people's coordinates in the report).  
8. **Regression:** Repeat after any RLS or match-RPC change. Also decide whether `is_society_admin` should keep full coordinate SELECT.

### B3. Cross-publication double-book is not atomic

1. **Screen:** Find a ride, request on two hosts.  
2. **RPC:** `cleaner_city_request_ride`. Index `uq_commute_publications_host_date_dir_active` covers hosts only.  
3. **Root cause:** `FOR UPDATE` locks the target publication. The guest-day check is a plain `EXISTS` with no shared lock and no unique constraint.  
4. **User impact:** One resident can hold two active seats the same morning.  
5. **Reproduce:** Two parallel RPCs, two publications, same date and direction. Not run here.  
6. **Evidence:** Live function flags `uses_advisory=false`, `locks_publication=true`; exception text present.  
7. **Correction:** Advisory lock or a uniqueness constraint on the guest for that date and direction, then repeat the parallel test. Opposite direction and a different date must still succeed.  
8. **Regression:** Concurrent pair plus the two legitimate cases.

### B4. Cancel, waitlist, and SOS lifecycles have no runtime evidence

1. **Screens:** Offer cancel, Find waitlist, Ride SOS, Admin incidents.  
2. **RPCs:** `cleaner_city_cancel_publication`, `cleaner_city_release_publication_seat`, `cleaner_city_notify_waitlist_for_publication`, `cleaner_city_report_incident`.  
3. **Root cause:** Not executed, to avoid real rides and emergency alerts.  
4. **User impact:** Guests may not be notified, seats may double-notify, or SOS counts may not match the queue. Unknown until tested.  
5. **Reproduce:** With designated test accounts only.  
6. **Evidence:** NOT RUN.  
7. **Correction:** Staging or an approved test society. Compare `notification_queue` rows to RPC counts. Confirm phone-only contacts increment `phone_only_contacts_skipped` and not `notified_contacts`.  
8. **Regression:** Zero, one, and many guests; second cancel is a no-op; blocked user gets no waitlist row.

### B5. No device proof of foreground tracking limits

1. **Screen:** Active ride.  
2. **Code:** `CleanerCityRidePage.tsx` interval plus copy that background tracking is not guaranteed.  
3. **Root cause:** No iOS or Android session.  
4. **User impact:** Pocket-safe behaviour is still unproven; copy may still be wrong on a real OS.  
5. **Reproduce:** Start a test ride, open Maps, lock the phone, return.  
6. **Evidence:** BLOCKED.  
7. **Correction:** Supervised dogfood. Do not describe the result as continuous background tracking.  
8. **Regression:** Same script on both platforms, plus Book, Orders, Contact, and delivery tracking smoke.

### B6. No Greenfield meetup points

1. **Screen:** Ride meeting-point picker.  
2. **Table:** `society_meetup_points`.  
3. **Root cause:** `count(*) = 0`. No approved coordinate list was provided, so nothing was inserted.  
4. **User impact:** Residents only have "Use GPS", not society gates or a clubhouse.  
5. **Reproduce:** Open the picker for a Greenfield ride.  
6. **Evidence:** SQL count 0 on 2026-11-01.  
7. **Correction:** Seed only coordinates taken from an authoritative map or site plan.  
8. **Regression:** Points render and `cleaner_city_set_meeting_point` stores the chosen row for both parties.

---

## What is actually true today

- Phase 1 privacy SQL is installed and a later migration fixed `can_access_feature` (`feature_key` on `society_feature_overrides`).  
- Vitest and `tsc` are green and do not prove production behaviour.  
- Email verification to arbitrary company addresses does not work until Resend domain setup is finished.

## Decision

**NOT READY FOR PILOT**

Do not start Phase 2 until B1 through B5 have executed evidence, and B6 is either seeded from real coordinates or explicitly waived.
