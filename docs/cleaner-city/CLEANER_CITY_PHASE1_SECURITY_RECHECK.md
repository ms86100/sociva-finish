# Cleaner City - Phase 1 Security Recheck

**Date:** 2026-11-01  
**Project:** `kkzkuyhgdvyecmxtmkpy`

---

## Prior P0 security findings - recheck

| Finding | Status after Phase1 | Evidence |
|---------|---------------------|----------|
| Publication coords via table SELECT | **FIXED in policy** | Prod policy host/admin only; selftest true |
| Circle invite_code society leak | **FIXED in policy** | Members-only SELECT; invite only via owner my_circles |
| SOS overclaim / dead fan-out | **FIXED honesty path** | Phone resolve + jsonb fan-out; sms_sent false |
| Publish without pins | **FIXED server-side** | Pin guards in publish_commute |
| Autopilot without email re-check | **FIXED** | Verified filter in autopilot_run |
| Double-book across publications | **FIXED in RPC** | Same date+direction guard |

---

## Residual security risks

1. **No column-level GRANT lockdown** - hosts still SELECT full own rows (intended). Peers blocked by RLS. Confirmed participants get meeting points via rides, not publications table.  
2. **Invite codes still reusable until expiry/rotate** - mitigated by 14-day expiry + rotate RPC.  
3. **Phone lookup** - only same/neighbour society; could still reveal that a phone exists by side-channel (returns null vs id). Acceptable for pilot; rate-limit later if abused.  
4. **SECURITY DEFINER functions** - continue to set `search_path = public`; REVOKE/GRANT pattern retained.  
5. **Feature flag** - restrictive feature_gate policies unchanged.  
6. **Share tokens** - unchanged 6h expiry; anon view still intentional.  
7. **Background location** - not a security implement; privacy copy corrected.

---

## Neighbouring Sociva surfaces

| Surface | Impact |
|---------|--------|
| Book / commerce | No schema shared; routes untouched |
| Orders / delivery GPS | Separate hooks; Cleaner City does not claim delivery BG |
| Notifications queue | New cleaner_city keys; idempotent enqueue keys used |
| Auth / society membership | Circles join now stricter |

---

## Verification commands (actual)

```sql
SELECT public.cleaner_city_phase1_privacy_selftest();
-- all six flags true (2026-11-01)
```

---

## Verdict

Phase 1 **security blockers for coordinate leak and invite leak are remediated in production policy/RPC**. SOS marketing honesty is remediated. Remaining residual risks are documented above and do not restore the original P0 table leaks.
