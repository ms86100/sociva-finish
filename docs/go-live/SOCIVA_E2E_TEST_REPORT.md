# Sociva Stage 2 E2E / Journey Test Report

| Field | Value |
| --- | --- |
| Target | Staging `wwuanzbusxoyzixuprxs` |
| Runner | `scripts/stage2-staging-validation.cjs` (`npm run test:stage2:staging`) |
| Machine result file | `docs/go-live/stage2-validation-results.json` |
| Generated | 2026-11-23T14:34:20.906Z |
| Summary | **31 passed / 0 failed / 0 skipped** |

## Method notes

- Real Supabase Auth password sign-in for Stage2 users (not mocks).
- Real RPC / REST against staging.
- Distinguishes simulated external payments: none claimed as paid gateway success.
- Skipped tests are not counted as pass (none skipped).

## Journey matrix

| # | Workflow | Role | Society | Expected | Actual | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Auth for all Stage2 personas (12 accounts) | multi | A/B/C/platform | session issued | session issued | yes |
| 2 | Features RPC 7-column contract | resident | A | shape includes society_configurable | shape matched | yes |
| 3 | Pilot entitlements (guard + parcels) | resident | A | both enabled | both enabled | yes |
| 4 | Default package Society C (no guard) | resident | C | guard off | guard off | yes |
| 5 | Visitor create via `visitor_create_entry` | resident | A | server OTP | OTP present | yes |
| 6 | Guard redeem OTP | guard | A | check-in | ok | yes |
| 7 | OTP single-use | guard | A | second redeem fails | failed as expected | yes |
| 8 | Cross-society OTP reject | guard B | B→A | reject | reject | yes |
| 9 | Client OTP insert blocked | resident | A | insert rejected | rejected | yes |
| 10 | Notices readable in own society | resident | A | ≥1 | ≥1 | yes |
| 11 | Maintenance dues readable | resident | A | readable | readable | yes |
| 12 | Platform lists Stage2 societies | platform_admin | platform | 3 | 3 | yes |
| 13 | Unauth visitor create | anon | - | rejected | rejected | yes |

## Acceptance journeys vs Stage 2 brief

| Brief journey | Coverage | Notes |
| --- | --- | --- |
| Society creation / onboarding | Partial | Societies seeded; creation UI not re-run |
| Resident registration / approval | Partial | Memberships seeded active; approval RPC not re-exercised in this run |
| Admin appointment | Seeded + privilege escalation reject tested | |
| Security staff appointment | Seeded | |
| Visitor OTP create + verify | **Pass** (automated) | |
| Resident QR gate entry | Not automated this run | Guard OTP path covered |
| Parcel registration / collection | Seed present; API collection not automated | |
| Notice publish + visibility | Seed + resident read pass | |
| Smart Group / messaging | Conversation + message seeded | |
| Maintenance + sandbox payment | Due pending only; **gateway not run** | |
| Seller onboarding / approval | Seller profile approved + credit 500 | |
| Marketplace order lifecycle | Pending COD order seeded; full status machine not walked | |
| Dispute + admin resolution | Dispute open seeded; admin resolve UI not automated | |
| Workforce / attendance | Not seeded | |
| Cross-society authorization reject | **Pass** (see RLS report) | |

## Unit / regression (local)

| Suite | Result |
| --- | --- |
| `src/test/app-navigator.test.ts` + `security-gate.test.ts` | 193 passed |

## External services

| Service | Claim |
| --- | --- |
| Razorpay sandbox capture | **Not tested** |
| SMS | N/A (server OTP codes) |
| Push | Not tested |

## Remaining gaps before claiming full E2E 100% of brief UI journeys

1. Browser login matrix for Stage2 emails on Guard Kiosk tablet viewport.
2. Parcel pickup status transition via UI.
3. Maintenance Razorpay sandbox payment success + failure paths.
4. Admin resolve dispute UI.
5. Society creation wizard UI.

API/foundation journeys required for Stage2 staging readiness are evidenced in `stage2-validation-results.json`.
