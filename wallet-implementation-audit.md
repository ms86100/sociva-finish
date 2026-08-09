# SOCIVA Wallet Implementation Audit

## Executive Summary

Current implementation score: **30/100**

Financial integrity score: **22/100**

Repository architecture completeness: **61%**

Production readiness: **NOT READY**

Release decision: **RED — FINANCIAL RELEASE BLOCKED**

Critical blockers: **6**

High-priority gaps: **12**

Remaining implementation and proof: **70%**

Seller payout: **DISABLED — must remain disabled**

Buyer withdrawal: **DISABLED — remains out of scope**

The repository contains substantial hardening code, but that is not the effective production system. The live Supabase catalog does not contain the two principal Aug 8 hardening migrations, the finance subledger, provider inbox, capture allocations, COD register, payout/refund attempts, reconciliation records, maker-checker controls, alerts, or financial trace RPCs.

The live system also retains unsafe legacy wallet privileges. Anonymous execution of `SECURITY DEFINER` mutation functions and destructive wallet-table privileges create an immediate credit-minting and ledger-corruption surface. Repository-side revocations exist, but undeployed source is not a production control.

Separately, current runtime logic still contains payment ordering and COD payout hazards. A `payment.failed` attempt can prevent a later valid capture from confirming. Seller-collected COD can produce an ordinary settlement that is eligible for an online Route payout. Payout eligibility does not require a successful capture allocation or clean reconciliation result.

The implementation is therefore not safe for seller payouts, buyer credit mutation, wallet refunds, automatic COD financial rollout, or Route transfers.

## Overall Score

Weighted score: **30/100**

- Implemented and effective: **30%**
- Partially implemented or repository-only: **31%**
- Missing or unproven: **39%**
- P0 findings: **6**
- P1 findings: **12**
- P2 findings: **14**
- P3 findings: **8**

Category scores:

- Architectural maturity: **61/100 repository; 20/100 live**
- Financial integrity: **22/100**
- Payment safety: **52/100**
- Ledger safety: **20/100**
- Refund safety: **45/100**
- COD safety: **20/100**
- Payout readiness: **15/100**
- Reconciliation: **8/100**
- Security: **10/100 live**
- Test coverage: **24/100 financial proof**
- Operational readiness: **10/100**
- UI completeness: **52/100**

## Release Decision

**RED — FINANCIAL RELEASE BLOCKED**

Repository code is not production proof. The production database is missing the hardening architecture, live wallet privileges are unsafe, payment-attempt ordering can strand captured money, and seller-collected COD can enter the payout path.

Keep every money-out and wallet-mutation feature disabled. Platform collection may continue only after the payment ordering defect, webhook deployment configuration, and edge/database version skew are fixed and verified.

## Phase-by-Phase Score

### Phase 0 — Money Model: 4/10

Implemented:

- Conservative engineering baseline.
- Platform-collect and deferred-settlement target model.
- Seller balances described as payables rather than custody wallets.
- Buyer SOCIVA Credit documented as non-loadable, non-transferable, and non-withdrawable.

Not proven:

- Merchant-of-record approval.
- Principal-versus-agent accounting approval.
- Razorpay/Route contractual approval.
- GST, TCS, 194-O, invoice ownership, commission taxation, refund taxation, chargeback liability, and COD accounting approvals.

Status: **PARTIAL**

### Phase 1 — Payment Stabilization: 14/20

Implemented in repository:

- Captured-only confirmation.
- No order-attached Route transfer.
- Grouped capture allocation model.
- Fail-closed provider lookup for auto-cancel.
- Exact refund attempt/provider identity.
- Durable webhook inbox and leases.

Remaining blockers:

- Attempt-level `payment.failed` can mark the entire order failed and block a later capture.
- Webhook `verify_jwt=false` is not versioned in `supabase/config.toml`.
- Create-order linkage across grouped children is not one transaction.
- Provider payload and out-of-order webhook fixtures are missing.

Status: **PARTIAL**

### Phase 2 — Core Subledger: 4/20

Repository design includes:

- Typed finance accounts.
- Integer minor-unit entries.
- Balanced posting RPC.
- Posted-transaction mutation guards.
- Journal templates and reversal support.

Effective production:

- Finance schema is absent.
- Legacy wallet remains decimal-based.
- Legacy wallet does not enforce journal balance at database level.
- Proposed immutability guard does not prevent appending entries to an already-posted journal.
- `service_role` receives direct table mutation privileges in the proposed schema.
- Idempotency short-circuit does not compare the complete payload.

Status: **REPOSITORY-ONLY / LIVE INCOMPLETE**

### Phase 3 — Migration and Reconciliation: 1/15

Implemented in repository:

- Backfill-candidate view.
- Internal reconciliation function.
- Feature flags and shadow-write switches.

Missing:

- Applied production migrations.
- Evidence-backed opening balances.
- Reviewed backfill application workflow.
- Provider statement ingestion.
- Bank settlement reconciliation.
- Shadow parity observation period.
- Read/write cutover evidence.
- Rollback rehearsal.

Status: **EARLY**

### Phase 4 — Financial Operations: 2/10

Repository code contains maker-checker requests, adjustments, alerts, trace RPCs, payout destinations, cooling periods, and limits.

None of those objects exist live. There is no deployed replay worker, dead-letter operation, alert ownership, reconciliation SLA, or incident evidence. The admin trace cannot provide a one-rupee trace against the live database.

Status: **CODE EXISTS / NOT OPERATIONAL**

### Phase 5 — Seller Payable and Refunds: 3/10

Implemented:

- More honest seller terminology.
- Intended server-authoritative payout summary.
- Exact refund attempts and provider references.
- Partial-refund amount checks.

Missing or unsafe:

- Seller summary RPC is absent live.
- Earnings KPIs remain GMV-oriented rather than a complete payable projection.
- Refund, payout, commission, fee, tax, discount sponsor, and liability journals are not runtime-connected.
- Refund-after-payout remains a manual hold rather than a controlled seller-liability workflow.
- Refund initiation and attempt insertion are separate crash windows.

Status: **PARTIAL / BLOCKED**

### Phase 6 — COD and Payout Pilot: 1/10

Implemented in repository:

- Payout claim serialization.
- Beneficiary reference, cooling period, limits, and kill switches.
- COD status table and UI distinction.

Critical gap:

- Seller-collected COD can create an ordinary seller settlement and pass payout claim checks.
- Payout eligibility does not require a capture allocation or reconciliation success.
- Unknown transfers have no provider-query recovery worker.
- No payout sandbox or provider-success/database-failure evidence exists.

Status: **BLOCKED**

### Phase 7 — UX and Release Evidence: 1/5

Implemented:

- Honest labels for SOCIVA Credit, payable, COD, and unverified settlement.
- Admin trace page in repository.

Missing:

- Live supporting RPCs.
- Wallet E2E journeys.
- Concurrency tests against PostgreSQL.
- RLS identity matrix.
- Provider fixture replay.
- Reconciliation fixtures using provider/bank data.
- Production-shaped migration test.
- Reconciled observation period.

Status: **BLOCKED**

## TODO Verification

### approve-money-model

- Declared status: completed
- Actual status: **PARTIAL**
- Score: **40%**
- Evidence: engineering baseline exists.
- Remaining: professional legal, provider, accounting, and tax approvals.

### stabilize-payments

- Declared status: completed
- Actual status: **PARTIAL**
- Score: **70%**
- Evidence: captured-only confirmation, provider inbox, exact refund attempts, and fail-closed auto-cancel exist.
- Remaining: `payment.failed` ordering, webhook deployment config, provider fixtures, and live proof.

### build-subledger

- Declared status: completed
- Actual status: **CODE COMPLETE / LIVE INCOMPLETE**
- Score: **35%**
- Evidence: strong local migration design.
- Remaining: migration execution, posted-entry append guard, payload-bound idempotency, reduced direct grants, runtime posting paths, and database tests.

### migrate-reconcile

- Declared status: in progress
- Actual status: **EARLY**
- Score: **10%**
- Evidence: candidate and internal-comparison code only.
- Remaining: deployment, evidence backfill, provider/bank reconciliation, shadow parity, and cutover.

### pilot-products

- Declared status: pending
- Actual status: **BLOCKED**
- Score: **5%**
- Evidence: control scaffolding exists.
- Remaining: close all P0/P1 issues and prove deployment/reconciliation.

### rewrite-briefs

- Declared status: pending
- Actual status: **SUBSTANTIALLY WRITTEN**
- Score: **80%**
- Evidence: phase briefs and decision documents exist.
- Remaining: remove stale completion language and align briefs with this audit.

## Actual Money Flow

### Online payment

Buyer checkout → local orders → Razorpay order → client/provider confirmation → `confirm-razorpay-payment` → payment capture record → atomic order/payment/wallet RPC → capture allocations → seller settlement after fulfillment → optional Route transfer.

Current authority is split:

- Razorpay is authoritative for provider capture.
- Orders and payment records determine operational paid state.
- Seller settlements determine payout eligibility.
- The finance ledger is not live.

### Refund

Refund request → approval → refund initiation → attempt insert → Razorpay refund → webhook/provider response → local completion → settlement hold/dispute.

Crash and recovery gaps remain between initiation and attempt creation, and after payout there is no complete seller-liability recovery model.

### COD

COD order → delivery/buyer or seller confirmation → order/payment marked paid → normal seller settlement creation → eligibility → potential payout.

This is unsafe for seller-collected COD because the seller already holds the cash.

### Auto-cancel

Expired seller acceptance → provider payment-state lookup → defer on unknown/authorized → confirm captured payment or cancel unpaid order → initiate refund when required.

Provider lookup is fail-closed, but a prior attempt-level `payment.failed` can poison the order before a later capture arrives.

### Multi-vendor

One provider capture → child orders → child payment records → capture allocations.

The model supports grouped children, but provider-order linkage, capture persistence, order confirmation, and allocation persistence are not one database transaction.

### Chargeback

No complete provider chargeback/dispute state machine or journal path was found.

### Withdrawal

No approved buyer withdrawal exists. Seller payout scaffolding exists, but payouts must remain disabled.

## Source of Truth

Verdict: **F — multiple conflicting sources**

- Provider capture: Razorpay.
- Operational payment state: `orders` and `payment_records`.
- Seller eligibility: `seller_settlements`.
- Buyer credit: legacy wallet cache and ledger tables.
- Canonical finance ledger: repository-only, absent live.

The intended hierarchy is not effective in production. Mutable operational tables can still determine payout state independently of a canonical journal and provider reconciliation.

## Ledger Audit

- Immutable journal: **PARTIAL in repository; absent live**
- Balanced debit/credit: **YES in proposed `post_journal`; NO for live legacy wallet**
- Typed accounts: **YES proposed; NO live canonical finance system**
- Integer paise: **YES proposed; legacy wallet uses numeric rupees**
- Idempotency: **PARTIAL; key reuse does not always compare payload**
- Reversal-only corrections: **PARTIAL**
- Database posting controls: **PARTIAL**
- Rebuildable projections: **PARTIAL repository; absent live**
- Attribution: **PARTIAL; metadata-heavy and not every runtime event posts**

Critical proposed-ledger defect:

The mutation guard blocks updates and deletes but does not block insertion of additional entries into an already-posted transaction.

## Payment Audit

Proven in source:

- Authorized payments are not treated as captured.
- Order creation no longer attaches a Route transfer.
- Provider amount/order binding exists.
- Grouped child allocations exist.

Not proven:

- Deployed source/database parity.
- Valid webhook ingress.
- Real provider signatures and payloads.
- Out-of-order attempt events.
- Atomic capture/order/allocation persistence.

Critical scenario:

Attempt A emits `payment.failed`; the webhook marks the order failed. Attempt B later captures on the same provider order. Confirmation advances only pending orders, so the buyer can be charged while the order remains unconfirmed.

## Refund Audit

Supported in source:

- Full provider refund.
- Amount-limited partial refund.
- Exact attempt and refund identities.
- Unknown provider outcome escalation.
- Duplicate request-key protection.

Incomplete:

- Multiple-partial-refund PostgreSQL concurrency proof.
- Complete multi-vendor tender/discount/tax/shipping allocation.
- Refund-after-payout liability recovery.
- Provider-query recovery for unknown outcomes.
- Atomic initiation plus attempt creation.
- Chargeback integration.

## Auto-Cancel Audit

Provider fetch failures now defer cancellation. Authorized states do not become paid. Captured states trigger confirmation/recovery.

Remaining:

- Attempt-level failed webhook ordering.
- Real concurrent accept/cancel database test.
- Delayed-capture fixture.
- Production scheduler and retry evidence.

## COD Audit

Current model: **mixed and inconsistently enforced**

- Seller-collected, courier-collected, and platform-collected types exist in proposed records.
- Seller-collected COD is described as non-withdrawable in UI/projections.
- Settlement creation and payout claim do not enforce that separation.

COD safety test:

- Online payable: ₹5,000
- Seller-collected COD: ₹10,000
- Expected withdrawable: ₹5,000
- Current payout design can make ₹15,000 eligible.

Verdict: **CRITICAL FINANCIAL BUG before payout enablement**

## Seller Payable Audit

The exact authoritative available formula is not complete in production.

Intended projection:

- Pending: settlement rows in pending state.
- Available: eligible rows.
- Reserved: processing payout rows.
- Paid out: settled rows with provider transfer ID.
- COD: separate COD records.
- Refunded: completed refunds.

Missing from the formula:

- Return-window policy evidence.
- Commission, tax, gateway fee, shipping, and discount sponsorship journals.
- Chargeback reserve.
- Post-payout seller liability.
- Required clean capture allocation and reconciliation.

## Payout Readiness

Payout scaffolding is not payout readiness.

Implemented in repository:

- Verified destination reference.
- Cooling period.
- Amount and frequency limits.
- Seller-scoped serialization.
- Attempt records and webhook finalization.
- Kill switches.

Missing:

- Live deployment.
- Seller-collected COD exclusion.
- Capture-allocation prerequisite.
- Reconciliation prerequisite.
- Provider HTTP idempotency mechanism.
- Unknown-transfer lookup worker.
- Provider-success/database-failure recovery evidence.
- Reservation and reversal finance journals.
- Maker-checker threshold workflow for actual payout requests.

Verdict: **NO**

## Buyer Credit Audit

Product boundary is conceptually correct:

- Non-loadable.
- Non-transferable.
- Nonwithdrawable.
- Promo expiry and lot model.

Live safety is unacceptable:

- Legacy mutation RPCs are over-privileged.
- Destructive wallet-table privileges exist.
- Cart does not consistently honor financial capability flags.
- Quote failure falls back to client-side arithmetic.
- JavaScript floating-point arithmetic remains in checkout display logic.
- No live canonical finance ledger or parity proof exists.

## Reconciliation Audit

Repository reconciliation compares internal tables with other internal tables. It does not ingest or match:

- Razorpay payment statements.
- Razorpay refund statements.
- Route transfer statements.
- Razorpay settlement statements.
- Bank settlement statements.

Required fixture results are therefore not proven:

- Equal ₹10,000 records: not executed against production-shaped database.
- Provider ₹9,500 mismatch: no provider statement fixture.
- Missing provider record: no provider statement fixture.
- Duplicate event: static/source tests only.

## Security Audit

Live critical findings:

- Anonymous execution of wallet mutation `SECURITY DEFINER` functions.
- Anonymous promo issuance because null identity is treated as service behavior.
- Anonymous direct wallet-ledger entry surface.
- Destructive wallet-table `TRUNCATE` grants.
- Anonymous settlement-fabrication function surface.

Repository-side revocations are not effective until applied and verified. RLS does not protect `TRUNCATE`.

Required adversarial tests are missing:

- Buyer A versus Buyer B wallet.
- Seller A versus Seller B payable.
- Client ledger insert/update.
- Client balance mutation.
- Payment-status mutation.
- Refund ownership crossing.
- Table privilege and function privilege catalog assertions.

## Financial Invariants

1. Sum of debits equals sum of credits: **PROPOSED PASS / LIVE NOT PRESENT**
2. Withdrawn is not greater than eligible payable: **NOT PROVEN**
3. Refunded is not greater than refundable provider amount: **PARTIAL**
4. COD does not increase online withdrawable balance: **FAIL in payout path**
5. One provider event creates at most one posting: **PARTIAL**
6. Posted journal cannot be mutated: **FAIL for append-after-post**
7. Every payout has a reservation: **CODED / NOT LIVE / NOT JOURNALED**
8. Every refund references original transaction: **PARTIAL**
9. Every seller payable traces to payment/order: **PARTIAL**
10. Every exception is visible in reconciliation: **FAIL**

## End-to-End Test Evidence

Fresh repository evidence:

- Full Vitest run: **1,413 passed, 312 skipped, 0 failed**.
- Six database/integration files skipped because production test functions are disabled.
- TypeScript check passes after lint remediation.
- Production web build passes.
- Full ESLint run has **0 errors**; legacy `any` and `@ts-*` debt remains visible as warnings.

Certification gaps:

- Most wallet tests inspect source strings.
- Money tests reimplement calculations rather than executing PostgreSQL.
- No production-shaped migration run.
- No property-based database ledger test.
- No true parallel race suite.
- No provider statement replay.
- No RLS identity matrix.
- No payout provider sandbox evidence.
- No wallet Playwright journey.
- Integration tests conditionally skip when test functions are disabled.

## Money Loss Scenarios

### Failed attempt followed by capture

- Current behavior: failed webhook poisons the order; later capture may not confirm.
- Expected: failed payment attempt must not make the provider order terminal.
- Impact: buyer charged, order unconfirmed.
- Severity: **P0**

### Seller-collected COD paid through Route

- Current behavior: COD becomes paid, creates settlement, and can pass payout claim.
- Expected: seller-collected COD never enters online payout.
- Impact: seller receives cash plus platform transfer.
- Severity: **P0**

### Anonymous wallet cash mint

- Current behavior: live anonymous caller can invoke privileged wallet credit.
- Expected: internal mutation callable only by trusted service paths.
- Impact: arbitrary credit creation.
- Severity: **P0**

### Anonymous promo mint

- Current behavior: null identity is interpreted as service behavior.
- Expected: cryptographic/service-role authorization, not null-user inference.
- Impact: arbitrary promo liability.
- Severity: **P0**

### Capture allocation failure followed by payout

- Current behavior: order may be paid before allocations persist; payout checks do not require allocation.
- Expected: payout eligibility requires complete allocation and clean reconciliation.
- Impact: unallocated or mismatched money paid out.
- Severity: **P0**

### Provider transfer unknown forever

- Current behavior: payout is held but no exact provider lookup worker resolves it.
- Expected: lookup provider by durable reference before retry/release.
- Impact: indefinite liability or unsafe manual action.
- Severity: **P1**

## Critical Findings

1. Live anonymous wallet mutation and destructive grants.
2. Live database is missing the financial hardening migrations.
3. `payment.failed` attempt ordering can strand a later capture.
4. Seller-collected COD can enter online payout.
5. Payout eligibility does not require capture allocation or clean reconciliation.
6. Anonymous settlement fabrication surface.

## P0 Findings

1. Immediately close live wallet function and table privileges through a reviewed emergency migration.
2. Prevent attempt-level `payment.failed` from making the entire order terminal.
3. Exclude seller-collected COD from settlement creation and payout claim at database level.
4. Require capture allocation and reconciliation success before payout eligibility.
5. Remove anonymous settlement-creation execution.
6. Apply hardening only after clean production-shaped migration and adversarial privilege tests.

## P1 Findings

1. Version webhook `verify_jwt=false` and prove HMAC processing.
2. Make provider-order linkage recoverable and transactional.
3. Add provider-query recovery workers for unknown refunds and transfers.
4. Post refund, COD, commission, settlement, reserve, payout, and reversal journals.
5. Block entry append to posted journals.
6. Bind idempotency keys to payload fingerprints.
7. Reduce direct `service_role` table mutations.
8. Add provider/bank statement reconciliation.
9. Build post-payout seller liability workflow.
10. Add real concurrency and RLS tests.
11. Resolve edge/database deployment skew.
12. Fix live confirm preflight failures.

## P2 Findings

1. Capability-aware buyer credit UI.
2. Remove client quote fallback as financial truth.
3. Add stable-cursor seller activity pagination.
4. Add typed admin one-rupee timeline.
5. Add alert acknowledgement, ownership, escalation, and SLA.
6. Add approved backfill application workflow.
7. Add migration catalog assertions.
8. Correct admin financial metric definitions.
9. Add seller statement and allocation detail.
10. Add chargeback state machine.
11. Add return reserves and negative-liability controls.
12. Add tax/fee/discount snapshot journals.
13. Add dead-letter event worker.
14. Add provider staleness policy.

## P3 Findings

1. Remove misleading historical completion wording.
2. Improve financial-data load failure states.
3. Add statement exports.
4. Add transaction filtering and reference links.
5. Replace raw JSON admin trace presentation.
6. Reduce legacy `any` and `@ts-nocheck` warnings.
7. Add concurrent-safe pagination tie-breakers.
8. Add retained reconciliation evidence dashboards.

## File-Level Changes Required

### `supabase/functions/razorpay-webhook/index.ts`

Problem: attempt-level failure updates whole order/payment state.

Required: model attempts separately; only mark an order terminal when provider order state is authoritatively terminal.

Test: failed attempt A followed by captured attempt B confirms exactly once.

### `supabase/migrations/20260807240000_phase0_status_settlement_stock.sql`

Problem: normal settlement creation includes COD.

Required: branch by payment type and collector; seller-collected COD must not create online payable.

Test: seller COD completion creates COD reconciliation only.

### `supabase/migrations/20260808062611_wallet_financial_operations.sql`

Problem: payout claim lacks COD, allocation, and reconciliation prerequisites.

Required: database-level exclusion and locked prerequisite checks.

Test: COD and unallocated captures cannot be claimed.

### `supabase/migrations/20260808055445_wallet_financial_hardening.sql`

Problem: posted transactions can receive new entries; runtime journal coverage is incomplete.

Required: reject insert when parent is posted and route all financial events through posting services.

Test: append-after-post fails; every event balances.

### `supabase/config.toml`

Problem: Razorpay webhook JWT bypass is not versioned.

Required: configure only Razorpay webhook with `verify_jwt=false`; retain application HMAC verification.

Test: unsigned Supabase JWT request with valid Razorpay HMAC reaches handler; invalid HMAC fails.

### `src/hooks/useWalletCredit.ts` and `src/hooks/useCartPage.ts`

Problem: capability flags and quote failures are not authoritative in UX.

Required: disable wallet use when capability or quote is unavailable.

Test: disabled flag never renders spend toggle.

## Database Changes Required

- Emergency privilege revocation, including function execution and table `TRUNCATE`.
- Attempt-aware payment state.
- COD collector constraint in settlement and payout paths.
- Payout prerequisites for allocation/reconciliation.
- Posted-entry insert guard.
- Payload fingerprints for idempotency.
- Provider statement staging tables.
- Reviewed backfill apply tables and approval workflow.
- Seller-liability and chargeback accounts.
- Deployment assertion migration.

## API Changes Required

- Provider-order attempt status endpoint/RPC.
- Provider event replay and dead-letter APIs.
- Unknown refund/transfer lookup worker.
- Stable seller financial activity pagination.
- Alert acknowledge/resolve RPCs.
- Backfill approve/apply RPCs.
- Provider statement import and match APIs.
- Typed admin trace API.

## Frontend Changes Required

- Capability-aware buyer credit.
- No client arithmetic fallback.
- Honest financial-data unavailable states.
- Separate seller pending, eligible, reserved, held, refunded, COD, and paid-out cards.
- Stable paginated activity and statement.
- Admin reconciliation queue and alert workflow.
- Typed one-rupee trace.

## Test Changes Required

- Apply migrations to disposable PostgreSQL/Supabase.
- Catalog privilege assertions.
- Cross-user RLS tests.
- Parallel wallet reserve tests.
- Concurrent accept/cancel tests.
- Failed-attempt/later-capture test.
- Multi-child allocation transaction test.
- COD payout exclusion test.
- Refund/payout race test.
- Unknown provider outcome recovery test.
- Provider-success/database-failure test.
- Provider statement mismatch fixtures.
- Property-based balanced-journal tests.
- Playwright wallet and seller-finance journeys.

## Operational Changes Required

- Legal, provider, tax, accounting, security, and privacy sign-off.
- Reviewed emergency privilege deployment.
- Versioned edge deployment configuration.
- Migration parity checks.
- Reconciliation schedule and ownership.
- Alert SLA and escalation.
- Incident runbooks.
- Opening-balance approval.
- Shadow observation period.
- Provider and bank statement retention.

## Phase Gate Results

- Gate 0 — Money model approved: **FAIL**
- Gate 1 — Payment path stabilized: **FAIL**
- Gate 2 — Ledger financially safe: **FAIL**
- Gate 3 — Migration reconciled: **FAIL**
- Gate 4 — Operational reconciliation proven: **FAIL**
- Gate 5 — Seller payable/refund safe: **FAIL**
- Gate 6 — COD/payout pilot safe: **FAIL**
- Gate 7 — UX and production evidence complete: **FAIL**

## What Is Safe To Enable

- Seller earnings UI: **NO** — required live projection RPC is absent.
- Seller refunds: **NO** — attempts/reconciliation are not live or proven.
- COD reconciliation: **NO** — COD subledger is absent live and payout segregation fails.
- Seller withdrawal: **NO** — payout is blocked.
- Buyer SOCIVA Credit: **NO** — live mutation privileges are unsafe.
- Buyer withdrawal: **NO** — out of scope and unapproved.
- Razorpay Route transfer: **NO** — COD and payout prerequisites fail.
- Automatic refund: **NO** — recovery and live attempt controls are unproven.

Limited safe use after immediate privilege closure:

- Read-only historical displays.
- Internal trace and shadow telemetry after deployment validation.
- Platform collection after payment ordering and webhook ingress are proven.

## What Must Remain Disabled

- `seller_payout_enabled`
- `provider_payout_mode`
- Route transfer modes
- `wallet_spend_enabled`
- `wallet_issue_enabled`
- `wallet_refund_credit_enabled`
- Buyer top-up
- Buyer P2P
- Buyer withdrawal
- Automatic COD/payable offsets

## Remaining Work

### P0 — Must fix before any further financial rollout

1. Close live anonymous wallet and settlement privileges.
2. Deploy only after production-shaped migration and privilege tests.
3. Fix failed-attempt/later-capture ordering.
4. Exclude seller-collected COD from online settlement and payout.
5. Require allocation and reconciliation before payout.

### P1 — Must fix before pilot

1. Deploy the subledger, attempts, controls, inbox, COD, reconciliation, and alerts.
2. Add posted-entry append protection and payload-bound idempotency.
3. Build provider/bank statement reconciliation.
4. Add unknown refund/transfer recovery.
5. Add real concurrency, provider, RLS, and migration tests.
6. Complete seller-liability and post-payout refund accounting.

### P2 — Required before production scale

1. Operational alerting, ownership, SLA, and incident drills.
2. Seller statements and admin reconciliation workflows.
3. Chargeback, reserve, tax, fee, and discount journals.
4. Stable pagination and capability-aware UX.
5. Retained clean reconciliation evidence.

### P3 — Post-launch improvement

1. Analytics and motivational UX.
2. Exports and richer transaction search.
3. Legacy type-debt cleanup.
4. Typed visual admin trace.

Estimated completion:

- Current implementation: **30% effective**
- Remaining: **70%**
- Critical financial work remaining: **large**
- Infrastructure/database work remaining: **large**
- Frontend work remaining: **medium**
- Testing work remaining: **large**
- Operational/reconciliation work remaining: **large**

## Final Recommendation

Do not deploy or enable money movement from the current repository state without a staged recovery plan.

First close live privileges. Then repair payment-attempt ordering and COD payout segregation. Apply migrations to a disposable production-shaped project, prove all grants and invariants, replay real provider fixtures, reconcile opening balances, and observe shadow parity. Only then consider a tightly capped internal pilot.

The repository is a useful hardening draft. It is not a production-ready financial system.

### If another senior engineering team audited this tomorrow, the top 10 findings would be:

1. **Anonymous wallet credit mint**
   - Why: arbitrary financial liability can be created.
   - Evidence: live `credit_wallet_cash` execution.
   - Severity: P0.
   - Fix: emergency privilege revocation plus adversarial test.

2. **Anonymous promo issuance**
   - Why: null identity is treated as service behavior.
   - Evidence: live `issue_wallet_promo`.
   - Severity: P0.
   - Fix: service-only execution and explicit authorization.

3. **Destructive wallet-table privileges**
   - Why: RLS does not protect `TRUNCATE`.
   - Evidence: live grants.
   - Severity: P0.
   - Fix: revoke all unnecessary table privileges.

4. **Hardening migrations are not deployed**
   - Why: repository controls have no production effect.
   - Evidence: live migration/catalog state.
   - Severity: P0.
   - Fix: production-shaped validation, reviewed deployment, parity assertion.

5. **Failed attempt can strand later capture**
   - Why: buyer can be charged while order remains failed.
   - Evidence: webhook and confirmation state predicates.
   - Severity: P0.
   - Fix: attempt-aware payment state.

6. **Seller-collected COD can be paid twice**
   - Why: seller receives cash and Route payout.
   - Evidence: COD paid status, generic settlement creation, payout claim.
   - Severity: P0.
   - Fix: collector-aware settlement exclusion.

7. **Payout ignores allocation/reconciliation readiness**
   - Why: unallocated or mismatched capture can be paid out.
   - Evidence: claim prerequisites.
   - Severity: P0.
   - Fix: locked allocation and clean-reconciliation gate.

8. **No provider or bank statement reconciliation**
   - Why: internal consistency is not external money truth.
   - Evidence: reconciliation compares local tables only.
   - Severity: P1.
   - Fix: statement ingestion and matching.

9. **Tests prove source shape, not financial behavior**
   - Why: regex tests cannot prove races, grants, or provider recovery.
   - Evidence: current wallet test suite.
   - Severity: P1.
   - Fix: PostgreSQL, provider fixture, RLS, concurrency, and E2E tests.

10. **Professional approvals are absent**
    - Why: accounting and regulated product boundaries remain unresolved.
    - Evidence: documents explicitly mark approvals pending.
    - Severity: P1.
    - Fix: obtain and record legal, provider, tax, accounting, security, and privacy approvals.
