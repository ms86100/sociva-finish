# Cleaner City - Security and Privacy Audit

**Audit date:** 2026-11-01  
**Scope:** RLS, SECURITY DEFINER RPCs, edge auth, ownership, cross-society/circle leakage, location privacy, rate limits, races, seat allocation, notifications, feature flag.  
**No application code modified.**  
**Note:** `cleaner-city-security.test.ts` is a static string contract on the foundation migration only - not a live RLS suite.

---

## Critical findings

### P0-S1 - Exact host coordinates readable pre-confirmation

- **Policy:** `commute_publications_select` (`20261102090000_cleaner_city_foundation.sql`) allows any authenticated user in the same society to SELECT published/full rows.
- **Columns:** Unit 5 added `origin_latitude/longitude`, `destination_latitude/longitude` on the same table.
- **Impact:** Match RPC intentionally returns corridor labels only; table API bypasses that and returns exact pins.
- **Reproduction:** As society peer, `from('commute_publications').select('origin_latitude,origin_longitude,destination_latitude,destination_longitude').eq('status','published')`.
- **Fix direction:** Revoke direct SELECT of coord columns; expose via SECURITY DEFINER views/RPCs gated by ride confirmation.

### P0-S2 - Circle invite codes leak society-wide

- **Policy:** `commute_circles_read` allows SELECT when `society_id = get_user_society_id(auth.uid())` OR membership.
- **Impact:** Non-members in the home society can read `invite_code` for every circle.
- **Reproduction:** Society peer selects `invite_code` from `commute_circles`.
- **Confirmed:** `cleaner_city_leave_circle` does not exist in prod - membership sticky once joined via leaked code.
- **Fix direction:** Restrict SELECT to members/owners; return invite code only to owners via RPC; expire codes.

### P0-S3 - SOS emergency contact notify is effectively dead

- **RPC:** `cleaner_city_report_incident` notifies contacts `WHERE notify_user_id IS NOT NULL`.
- **UI:** `CleanerCitySafetyPage` `addContact()` never passes `notify_user_id`.
- **Impact:** Copy claims contacts are notified; phone-only contacts never receive in-app SOS; no SMS path.
- **Privacy/safety:** Overstates protection to residents.

### P0-S4 - Publish without server-side pin validation

- **RPC:** `cleaner_city_publish_commute` can publish with null coordinates.
- **Impact:** Geographically meaningless inventory; privacy filters that depend on coords skipped in matching.

---

## High findings

### P1-S1 - Autopilot does not re-verify work email nightly

Verified only at `cleaner_city_set_autopilot`. Revoked/expired verification still auto-publishes.

### P1-S2 - Waitlist notify ignores blocks

`cleaner_city_find_matches` / `request_ride` check `commute_blocks`; `cleaner_city_notify_waitlist_for_publication` does not.

### P1-S3 - No guest double-book guard across publications

Same guest can hold multiple active requests/rides for same date/direction on different hosts.

### P1-S4 - Autopilot duplicate race

No UNIQUE(host, travel_date, direction); concurrent cron/manual can insert duplicates.

### P1-S5 - Circle join has no cross-society gate

Any verified commuter with a code can join; no neighbour-society check.

### P1-S6 - Share tokens

- Expiry 6h enforced in `cleaner_city_view_shared_ride` - good.
- Anon can view while valid - intentional for trusted contacts.
- Ensure tokens are unguessable (migration uses random bytes - inspect strength on rotate).

---

## SECURITY DEFINER hygiene

| Check | Observation |
|-------|-------------|
| `search_path` | Consistently set on reviewed Cleaner City functions |
| REVOKE FROM PUBLIC | Present on reviewed RPCs |
| GRANT | authenticated / service_role as appropriate |
| Autopilot run | GRANT service_role only - good for cron |
| Participant checks | Present on ride location, no-show, meeting point, quick messages |

No search_path hijack pattern found in sampled Cleaner City RPCs.

---

## Edge Function authentication

| Function | Auth model | Notes |
|----------|------------|-------|
| `cleaner-city-work-email-otp` | User JWT expected; domain allowlist; rate concepts in body codes | Out of five-feature core but gates Autopilot eligibility. Ops: `resend_from_email` still missing historically. |
| No dedicated autopilot edge | N/A | Autopilot is DB cron → SQL function |

---

## Location privacy

| Surface | Status |
|---------|--------|
| Office locations RLS | Owner-private (foundation) - good |
| Match RPC | Labels + meters - good design |
| Publications table SELECT | **Leaks coords** - bad |
| Ride locations | Participant-only + active status - good |
| Share page | Token + expiry - acceptable for intentional share |
| Background tracking consent | Foreground only; honest "keep app open" copy - good honesty, weak safety |
| Emergency contact phone | Stored; not SMS-verified |

---

## Rate limits / abuse

| Control | Present? |
|---------|----------|
| Live location write every 3s | Yes |
| Quick messages 3 / 2 min | Yes |
| No-show participant-only | Yes |
| OTP edge rate | Edge function codes (not re-audited end-to-end here) |
| Waitlist join unique | Yes |
| Circle invite abuse | No expiry / no revoke UX |

---

## Feature flag enforcement

Restrictive policies using `can_access_feature(..., 'cleaner_city')` exist on core commute tables (foundation). Admin bypass via `is_admin`. Society-admin paths for settings/incidents use admin helpers.

**Gap:** Direct SELECT of sensitive columns still allowed when feature on - flag does not equal privacy.

---

## Regression surfaces (security-adjacent)

| Product area | Risk from Cleaner City changes |
|--------------|--------------------------------|
| Book / commerce | Low - separate routes/tables |
| Orders / delivery GPS | Medium confusion only - delivery uses different tracking hook; CC must not claim delivery-grade BG GPS |
| Contact tab | Low |
| Notifications | Shared queue - malformed Cleaner City items could noise queue; not observed as breaking other types |
| Profile / society verification | Work-email OTP is additive; domain allowlist must stay admin-controlled |

---

## Recommended security fix order (do not implement in this audit)

1. Lock down publication coordinate columns / RLS  
2. Lock down circle invite_code SELECT + add expiry  
3. Make SOS notify path real or stop claiming it  
4. Server-enforce publish pins  
5. Re-verify work email in autopilot_run  
6. Block filter + unique day seat claims on waitlist/request paths  
