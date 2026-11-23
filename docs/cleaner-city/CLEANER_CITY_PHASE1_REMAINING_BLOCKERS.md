# Cleaner City - Phase 1 Remaining Blockers

**Date:** 2026-11-01

---

## Classification legend

- **Fixed and verified** - code + prod selftest and/or vitest prove behaviour  
- **Fixed but not yet runtime verified** - implemented; lacks live multi-user/device proof  
- **Partially fixed** - improved but incomplete vs ideal  
- **Still broken / deferred** - known gap remaining  
- **Blocked by external dependencies or devices**  
- **Requires product or legal decision**

---

## Status board

| Item | Classification |
|------|----------------|
| Publication coordinate RLS | Fixed and verified (policy + selftest) |
| Circle invite RLS + expiry + leave | Fixed and verified (policy/RPC + selftest); 3-account live still open |
| SOS honesty + Sociva phone link | Fixed but not yet runtime verified (delivery) |
| Admin SOS in-app notify | Fixed but not yet runtime verified |
| Publish pin server validation | Fixed and verified (selftest); live RPC fixture open |
| RoutePage Bangalore overwrite | Fixed and verified (source + vitest) |
| Publication cancel cascade | Fixed but not yet runtime verified |
| Waitlist on seat free + block filter | Fixed but not yet runtime verified |
| Double-book guard | Fixed but not yet runtime verified |
| Autopilot email + unique + cancel drafts | Fixed but not yet runtime verified |
| Matching honesty copy (Approach B) | Fixed and verified (vitest) |
| True road-polyline matching | Still broken / deferred (Approach A not chosen) |
| Native background tracking iOS/Android | Still broken / deferred |
| SMS / 112 SOS | Requires product decision (not built; copy honest) |
| Masked calling | Deferred |
| Meetup POI seed Greenfield | Ops / still empty (0 rows historically) |
| Resend From domain for OTP | Blocked by external ops |
| Time-limited waitlist seat hold | Partially fixed (notify only; no atomic hold) |
| Circle member remove UI picker | Partially fixed (RPC exists; UI leave/rotate only) |
| Book/Orders/Contact e2e | Blocked - not executed this phase |

---

## Pilot-readiness decision (post Phase 1)

### READY WITH CONDITIONS

Phase 1 removed the worst privacy and honesty blockers and hardened Autopilot / waitlist / cancel / publish pins in production.

**Conditions before any resident pilot:**

1. Run a supervised dual-account RLS smoke (peer cannot read publication coords or circle invites).  
2. Confirm OTP delivery with a verified Resend From address.  
3. Seed at least a few Greenfield meetup points (ops).  
4. Brief residents that matching is approximate corridor fit and live location needs the app open.  
5. Keep Circles invite rotation discipline for owners.  
6. Do **not** market Pocket-Safe background tracking or SMS SOS.  
7. Staff dogfood cancel + waitlist notify once on real devices.

**Not READY FOR PILOT** if those conditions are skipped - especially OTP ops and dual-account privacy smoke.

---

## Recommended next phase (approval required)

1. Live RLS penetration suite with fixtures  
2. Device tracking honesty QA (confirm no overclaim)  
3. Optional Approach A road matching  
4. Optional native background geolocation with store-compliant consent  
5. Meetup seed + waitlist hold if product wants reservation semantics  

Do not start those without explicit approval.
