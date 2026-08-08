---
name: sociva-production-certification
description: Certifies Sociva production readiness through evidence-first UI, API, database, Android, payment, security, performance, and observability testing. Use for comprehensive production certification, release go/no-go audits, full buyer-seller lifecycle testing, or readiness rescoring.
---

# Sociva Production Certification

## Mission

Certify the deployed Sociva release, not assumptions or code intent. Exercise real production UI flows, verify API/database effects, record reproducible evidence, fix confirmed defects within scope, and issue an evidence-based GO, CONDITIONAL GO, or NO-GO.

Read `.cursor/skills/seller-e2e-testing/SKILL.md`, the Supabase skill, the Canvas skill, and `docs/seller-e2e-test-plan.md` before execution.

## Non-negotiable safety and evidence rules

- Assign exactly one result to every case: `PASS`, `FAIL`, `BLOCKED`, or `NOT TESTED`.
- `PASS` requires direct evidence from this run. Prior reports and code inspection are context, never fresh PASS evidence.
- `FAIL` requires observed deviation plus reproduction details. Do not infer failure only from missing code.
- `BLOCKED` requires an attempted test or confirmed unavailable prerequisite and the exact action needed to unblock it.
- `NOT TESTED` means the case was not attempted. Never disguise it as blocked or passed.
- Prefer the real UI. Use API/database checks to verify UI effects or test backend-only boundaries.
- For writes, capture pre-state, UI/API action, post-state, identifiers, and cleanup result.
- Verify UI, API, and database consistency for every state-changing flow.
- Never run destructive production money operations unless safe low-value test credentials, accounts, and refund/cleanup paths are confirmed.
- Never trigger an uncontrolled real payout, transfer, charge, notification blast, or data deletion.
- Use uniquely prefixed fixtures such as `CERT-<UTC timestamp>-<case>` and preserve existing user data.
- Clean up only fixtures created by this run. Record leftovers and exact identifiers if cleanup is unsafe or fails.
- Redact access tokens, OTPs, private keys, personal data, payment identifiers, and service-role secrets from evidence.
- Do not expose or copy secrets into reports, screenshots, commands, commits, or chat.
- Never weaken RLS, webhook authentication, upload policies, or payment controls to make a test pass.
- After every fix, add or update a regression test, rerun the failing case, and rerun adjacent dependent cases.
- Do not claim a defect resolved until all three checks pass.
- Do not touch unrelated untracked files, especially `.tmp-*`.

## Environment gate

Before testing, record:

1. UTC start time, production URL, git SHA/branch, deployed app version, and APK version.
2. Browser/device/OS, viewport, network mode, Supabase project reference, and payment mode.
3. Available buyer, seller, admin, payment, push, and Android fixtures without revealing secrets.
4. Whether production writes, low-value payment, refund, push, and cleanup are authorized and safe.
5. Existing known gaps. Preserve them as unverified until this run produces evidence.

If authentication, production URL, or test accounts are unavailable, continue all anonymous, static, API, database, and code-verifiable work and mark only dependent cases `BLOCKED`.

## Execution method

For each case:

1. Define the expected UI state, API behavior, database invariant, and cleanup.
2. Capture pre-state using the least-privileged available identity.
3. Perform the action through the real UI where feasible.
4. Capture route, visible state/toast, screenshot, request/response status, and relevant IDs.
5. Query the database using scoped/redacted assertions; never dump unrelated customer rows.
6. Compare UI/API/database states and check duplicate or unauthorized effects.
7. Restore or delete only this run's fixture.
8. Record result and evidence immediately.

Evidence hierarchy:

1. Real UI action plus API/database assertion.
2. API action plus database assertion for backend-only behavior.
3. Automated test output tied to release SHA.
4. Static code/config inspection, which may prove presence or absence but normally cannot prove a live journey PASS.

## Scenario matrix

Create atomic case IDs under these groups. Do not collapse unexecuted subcases into a group PASS.

### C01 Auth and authorization

- Buyer registration, login, logout, reset/OTP recovery, refresh, and session expiry.
- Seller registration and complete onboarding, including admin approval boundary.
- Buyer, seller, other-seller, anonymous, and admin role/RLS authorization.
- Expired/revoked token behavior and protected-route redirect.

### C02 Seller operations

- Multi-store switcher and store isolation; measure and record the switch blank interval.
- Store create/read/update, pause/resume, settings, and safe deletion when permitted.
- Product create/read/update/delete, image upload, stock, variants, and store ownership.
- Service create/read/update/delete and availability.
- Coupon create/read/update/delete, validation boundaries, and ownership.
- Earnings accuracy and seller order actions.

### C03 Buyer discovery

- Home, categories, search, filters, sort, product, service, and store details.
- Wishlist add/remove/persistence.
- Reviews create/display/authorization/moderation behavior when available.

### C04 Cart and checkout

- Add/update/remove, cross-store rules, stock boundaries, and stale stock.
- Address create/read/update/delete and ownership.
- Coupon valid/invalid/expired/reuse cases.
- Totals, tax, delivery, rounding, server authority, and UI agreement.
- Rapid taps, double submit, request retry, and idempotent order/payment creation.

### C05 Payments

- Current UPI deep-link launch, success, failure, cancel, app/browser return, and reconciliation.
- Webhook signature/authentication and duplicate/out-of-order event idempotency.
- Refund request, processor result, order/payment/wallet consistency, and duplicate prevention.
- Card path only when configured in the deployed checkout.
- Razorpay Route linked accounts and transfers only when enabled and safe test credentials exist.

### C06 Orders and delivery

- Buyer places order; seller sees and accepts or rejects.
- Fulfil/dispatch, tracking, completion, cancellation, refund, and invalid transitions.
- Buyer/seller views and database agree after every transition.

### C07 Booking

- Service selection, availability, slot booking, concurrent slot collision, and payment.
- Seller accept/complete/cancel, buyer cancellation, refund, and invalid transitions.
- Chat booking links point to the correct booking and enforce participant access.

### C08 Chat and realtime

- Buyer-to-seller and seller-to-buyer messages.
- Ordering, duplicate prevention, reconnect delivery, unread counts, and read state.
- Attachment upload/display/access when available.
- Non-participant and cross-store RLS isolation.

### C09 Notifications

- In-app notification creation, recipient, copy, deep link, unread/read state, and dedupe.
- Push delivery, tap/deep link, foreground/background behavior when configured and device exists.
- Ensure unrelated users receive nothing.

### C10 Wallet, loyalty, and coupons

- Authorized credit/debit, balance ledger agreement, insufficient funds, and idempotency.
- Loyalty earning and redemption; no duplicate award on retries.
- Coupon redemption limits and order linkage.

### C11 Navigation and UI

- Every discoverable route, button, and link; browser/app back and supported deep links.
- Loaders, error boundaries, empty states, offline messages, responsive breakpoints.
- Keyboard navigation, focus visibility, labels/names, contrast basics, and zoom/text overflow.
- Store-switch blank issue measured with timestamped visual or performance evidence.

### C12 Resilience edge cases

- Offline/slow network, request timeout, upload failure, and retry.
- Rapid taps, background/resume, expired token mid-action.
- Long and special-character text, large/invalid image, and interrupted upload.

### C13 Android APK

- Confirm latest downloadable production APK identity and checksum.
- Available emulator/device: clean install, upgrade, launch, login, deep links, payment return, push, background/resume, navigation, keyboard, camera/image picker, and safe-area smoke.
- No device/emulator: mark each device-only case `BLOCKED` with required emulator/device, API level, architecture, APK, and credentials.

### C14 Performance and security

- Repeated/duplicate API calls, request waterfalls, obvious render loops, route/load latency, and large payloads.
- Supabase security/performance advisors and recent auth, database, storage, realtime, and edge logs.
- RLS on exposed tables, least privilege, cross-user/cross-store denial, views/functions, storage policies, unsafe uploads.
- No service-role/private secrets in client bundles or repository; publishable/anon keys alone are not secret findings.
- Payment creation authority, webhook signature validation, replay protection, and refund authorization.

### C15 Observability

- Sentry/APM SDK and deployed configuration, release SHA/version/environment metadata.
- Captured controlled error and trace when safe.
- PII/token/payment redaction, source maps, alerts, ownership, and incident routing.
- Absence or inaccessible vendor configuration is `BLOCKED` or `FAIL` according to whether the product claims it is configured.

## Defect and fix loop

When a reproducible defect is found:

1. Record `CERT-<group>-<sequence>`, severity, environment, preconditions, exact steps, expected/actual, evidence, and affected IDs.
2. Confirm root cause using runtime evidence plus focused code/config inspection.
3. Implement the smallest root-cause fix within controlled code/config.
4. Add or update regression coverage before declaring resolution.
5. Run targeted tests, production build when user-facing code changed, the failing live scenario, and adjacent dependent scenarios.
6. Record fix SHA and all regression evidence. Keep unresolved external/vendor issues blocked.

For user-facing web/native-wrapper changes, follow the repository release route: production build, native build/version when applicable, commit, push without force, and refresh the downloadable APK. Skill/report-only changes do not require APK rebuild.

## Database and security checks

Before Supabase operations, read MCP tool descriptors. Start with `list_tables`, `get_logs`, and `get_advisors`; use read-only, scoped SQL for assertions. Do not apply migrations during certification unless a confirmed defect requires a reviewed schema fix.

Check:

- RLS enabled on every exposed table and policies match actual roles/ownership.
- Authorization does not trust user-editable metadata.
- Views do not bypass intended RLS; privileged functions have safe schema/search path and restricted execute grants.
- Storage policies constrain owner, type, size, and path.
- Edge functions enforce identity, ownership, input validation, idempotency, and provider signatures.

## Required audit artifact

Update `canvases/sociva-production-readiness-audit.canvas.tsx` with one row per atomic case:

- case ID and scenario
- result and UTC timestamp
- environment/release
- redacted account or fixture
- UI evidence
- API/database evidence
- defect ID and severity
- fix SHA
- regression tests
- cleanup
- exact blocker/prerequisite

The canvas must distinguish current-run evidence from historical evidence and show no empty placeholder sections.

## Scoring and release decision

Score only current evidence:

- Auth/authorization: 12
- Seller: 10
- Discovery: 6
- Cart/checkout: 10
- Payments: 12
- Orders/delivery: 10
- Booking: 7
- Chat/realtime: 6
- Notifications: 5
- Wallet/loyalty/coupons: 5
- Navigation/UI/resilience: 5
- Android: 4
- Performance/security: 5
- Observability: 3

Within each area, award points proportionally for PASS cases. FAIL, BLOCKED, and NOT TESTED earn zero. Do not inflate scores with static inspection when live behavior is required.

- `GO`: score >= 90, no Critical/High FAIL, no release-critical BLOCKED cases, and core buyer-to-seller paid lifecycle plus Android smoke passed.
- `CONDITIONAL GO`: score 80–89, no Critical FAIL, and every High/blocker has an explicit accepted mitigation/owner.
- `NO-GO`: score < 80, any Critical FAIL, unresolved High on a core journey, or payment/order authorization/integrity uncertainty.

## Completion report

Return:

- skill path
- counts of PASS, FAIL, BLOCKED, and NOT TESTED
- confirmed defects and fixes
- regression evidence
- commits/push/APK status
- exact remaining user/vendor prerequisites
- final weighted score and GO/CONDITIONAL GO/NO-GO

Never summarize a group as PASS when any required atomic case lacks evidence.
