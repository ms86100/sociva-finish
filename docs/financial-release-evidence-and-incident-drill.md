# Financial release evidence and incident drill

This workstream is read-only. It must not seed production, create orders,
reserve credit, contact a payment provider, invoke reconciliation workers, or
change a financial capability. A missing prerequisite is `BLOCKED` and makes
the release gate fail.

## Required release environment

Authenticated UI fixtures:

- `FINANCIAL_BASE_URL` — deployed app URL (defaults to `https://www.sociva.in`).
- `FINANCIAL_BUYER_PHONE`, `FINANCIAL_BUYER_OTP` — buyer with an existing cart
  item and positive existing Sociva Credit.
- `FINANCIAL_BUYER_EXPECTED_CREDIT_MIN_MINOR` — minimum known credit for that
  buyer, in INR minor units.
- `FINANCIAL_SELLER_PHONE`, `FINANCIAL_SELLER_OTP` — approved seller owning the
  existing COD history under test.
- `FINANCIAL_SELLER_EXPECTED_COD_MIN_MINOR` — minimum known COD history for that
  seller, in INR minor units.
- `FINANCIAL_ADMIN_PHONE`, `FINANCIAL_ADMIN_OTP` — platform admin authorized to
  open `/#/admin/financial-trace`.
- `FINANCIAL_COD_ORDER_REFERENCE` — existing COD order with a `cod_transactions`
  record and no `seller_settlements` row.
- `FINANCIAL_RECONCILED_REFERENCE` — existing reference with a matched,
  zero-variance external reconciliation record.
- `FINANCIAL_EXCEPTION_REFERENCE` — existing open/investigating reconciliation
  exception with owner/assignment evidence.

Read-only production evidence:

- `SUPABASE_PROJECT_REF=kkzkuyhgdvyecmxtmkpy`
- `SUPABASE_URL=https://kkzkuyhgdvyecmxtmkpy.supabase.co`
- `SUPABASE_ACCESS_TOKEN` — Supabase Management API token able to read project
  advisors and logs.
- `FINANCIAL_EVIDENCE_SERVICE_KEY` — short-lived production evidence secret
  supplied only at run time. The script performs only RPC/REST reads; rotate it
  after the evidence run and never save it in a file or report.
- `FINANCIAL_SHADOW_WINDOW_START`, `FINANCIAL_SHADOW_WINDOW_END` — reviewed ISO
  timestamps delimiting the immutable shadow-parity window.

Run:

```powershell
node scripts/run-financial-release-gate.mjs
```

The gate requires exactly five authenticated tests, fails on every skipped
test, and first requires clean advisors, clean financial error logs, disabled
money movement, completed provider and bank imports, matched zero-variance
reconciliation records, and no open exception in the selected window.

## Evidence handling

- Record UTC start/end, git SHA, deployed version, browser version, project ref,
  and window.
- Retain the JSON console summary and Playwright report/artifacts.
- Redact OTPs, access tokens, service keys, phone numbers, provider IDs, and
  customer data.
- A test is `PASS` only from current-run evidence. Missing fixtures, missing
  credentials, inaccessible logs, or an empty shadow window are `BLOCKED`, not
  pass or skip.
- Do not call `reconcile-financials`: its current “read” mode persists rows.

## Rollback and incident drill checklist

Use this as a tabletop/read-only drill unless incident command explicitly
authorizes a change.

- [ ] Name incident commander, finance owner, security owner, communications
  owner, and independent approver.
- [ ] Record UTC detection time, release SHA, affected environment, first known
  reference, affected rail, and customer/seller scope.
- [ ] Capture current financial preflight, capability values, provider mode,
  recent financial logs, advisor output, exception counts, and reconciliation
  window before any intervention.
- [ ] Confirm all movement gates are disabled: payment create/confirm, webhook
  mutation, refund processing, seller payout/Route transfer, wallet
  spend/issue/refund-credit, COD offset, recovery mutation, and reconciliation
  writes.
- [ ] Preserve logs, webhook fingerprints, provider/bank import checksums,
  journals, attempts, settlements, exceptions, and audit events. Do not edit or
  delete evidence.
- [ ] Identify the last known-good migration/function/app release and verify its
  rollback artifact checksum and owner approval.
- [ ] Rehearse rollback commands only against a disposable environment. Do not
  run production rollback from this checklist.
- [ ] Require maker/checker approval, backup/restore point, blast-radius review,
  customer impact review, and a forward-fix decision before production action.
- [ ] After authorized containment, rerun preflight and prove no new movement
  attempts, no duplicate provider calls, and no journal mutation.
- [ ] Reconcile every affected reference across order, capture, allocation,
  journal, settlement, bank/provider statement, refund/chargeback, and
  exception records.
- [ ] Keep the release `NO-GO` until unexplained variance is zero, all critical
  exceptions have owner/resolution evidence, and the five authenticated
  financial journeys pass without skips.
- [ ] Record recovery time, residual risk, customer remediation, approvers,
  evidence links, and follow-up actions with owners and due dates.
