# Cleaner City - Phase 1 RLS Penetration Results

**Date:** 2026-11-01  
**Project:** `kkzkuyhgdvyecmxtmkpy`

No resident JWT was available. Every row below is **BLOCKED** for the authenticated test. Catalog facts are listed only so the intended rule is visible. They are **not** a PASS.

## Publication privacy

| # | Actor | Request | Expected | Actual | Status |
|---|--------|---------|----------|--------|--------|
| P1 | A (host) | SELECT own `commute_publications` row including coordinates | Allowed | Not executed | BLOCKED |
| P2 | B (same society, no ride) | `GET /rest/v1/commute_publications?select=origin_latitude,destination_latitude` | Zero rows or column denied | Not executed | BLOCKED |
| P3 | B | Same with filters, embeds, and `select=*` | No exact coordinates | Not executed | BLOCKED |
| P4 | C (other society) | SELECT A's publication | No row | Not executed | BLOCKED |
| P5 | B | `cleaner_city_find_matches` before confirm | Corridor labels, not exact home/office pins of the host | Not executed | BLOCKED |
| P6 | A and B after confirm | Ride row meeting point | Shared meeting point only if set | Not executed | BLOCKED |
| P7 | Society admin | SELECT publication coordinates | Allowed by current policy | Not executed | BLOCKED |

### Policy text actually installed (service role, not a penetration test)

`commute_publications_select`:

```text
is_admin(auth.uid())
OR is_society_admin(auth.uid(), society_id)
OR host_user_id = auth.uid()
```

Society peers are no longer in the USING clause. That is necessary but not sufficient proof.

### Why society admins can read coordinates

The policy grants `is_society_admin(auth.uid(), society_id)` full row SELECT. That exists so a society admin can investigate a published commute (safety / dispute). It is broader than "confirmed participants only". Whether that privilege should remain for a resident pilot is a product decision. It was **not** exercised with an admin session in this gate.

`cleaner_city_find_matches` is designed to return labels and deviation meters rather than raw host pins. Output was **not** captured from a resident call.

## Circle privacy

| # | Actor | Request | Expected | Actual | Status |
|---|--------|---------|----------|--------|--------|
| C1 | Non-member, same society | SELECT `commute_circles.invite_code` | No row | Not executed | BLOCKED |
| C2 | Member | `cleaner_city_my_circles` | Invite code null unless owner | Not executed | BLOCKED |
| C3 | Owner | Rotate invite | Old code rejected | Not executed | BLOCKED |
| C4 | Anyone | Expired code join | Rejected | Not executed | BLOCKED |
| C5 | Unauthorised society | Join with a valid code | Rejected by society/neighbour gate | Not executed | BLOCKED |
| C6 | Member | Leave, owner remove, rejoin | Leave/remove succeed; rejoin needs a live code | Not executed | BLOCKED |

Installed `commute_circles_read` (catalog only):

```text
is_admin(auth.uid())
OR EXISTS (member row for auth.uid())
```

`cleaner_city_phase1_privacy_selftest()` returned `circles_read_members_only: true` and `publications_select_blocks_society_peers: true`. That function runs as a privileged SQL check of policy text. **It is not this penetration test.**

## Verdict

Authenticated RLS penetration: **BLOCKED**. Release cannot treat privacy as verified.
