# Adversarial post-implementation audit: Evolution Go WhatsApp

Date: 2026-11-03  
Question under test: **Can Evolution Go fail (or be mis-operated) without damaging Sociva's existing order notification system?**  
Method: Source inspection of the shipped integration. No staging deploy. No handset evidence.  
Rule: HTTP accept is not delivery. Contract tests are not E2E proof.

## Executive verdict

| Axis | Verdict |
|------|---------|
| Order create / checkout | **Safe** - WA path is after commit; failures are caught in PNQ |
| Native push independence | **Mostly safe** - WA errors do not abort push; see F2 for retry coupling |
| Meta path when `active_provider=meta` | **Safe by default** - adapter defaults to Meta if config missing |
| Production readiness | **Not ready** - keep Meta active; fix or accept F1-F3 before Evolution live |
| Staging validation | **Appropriate next step** after migration review |

**Bottom line:** With Meta kept active, this change is unlikely to damage order creation or Meta WhatsApp. The dangerous zone is **operating Evolution Go as the active provider** (or using cross-provider retry) without understanding push/WA re-execution coupling.

---

## Five production insistences (scorecard)

| Insistence | Status | Notes |
|------------|--------|-------|
| 1. No duplicate WhatsApp during switch/retries | **FAIL (conditional)** | Provider switch itself does not dual-send. **PNQ push retries re-run WA** (pre-existing + still true). Explicit cross-provider retry re-queues the whole row and will WA + push again. |
| 2. No lost seller notifications when Evolution unavailable | **PASS for push / FAIL for WA** | Push continues. WA fails closed (no Meta fallback) by design when Evolution is active - sellers lose WhatsApp until kill switch or audited retry. |
| 3. Push continues independently of WhatsApp | **PASS with caveat** | WA is try/catch before push. Caveat: admin cross-provider retry resets the queue row and can re-fire push. |
| 4. Failed messages keep original provider unless audited retry | **PASS** | Attempts logged per `whatsapp_messages.provider`. No silent reroute. Retry is audited. |
| 5. Immediate Meta restore without redeploy | **PASS** | `admin_rollback_whatsapp_provider_to_meta` + Admin kill switch. |

---

## Findings (ordered by severity)

### F1 - High - Push failure retries re-send WhatsApp

**Where:** [`process-notification-queue/index.ts`](../../supabase/functions/process-notification-queue/index.ts) - WA block runs on every claim; on push failure status returns to `pending` and WA runs again.

**Reproduction:**
1. Active provider Meta or Evolution.
2. Force push failure (no tokens / invalid tokens) after WA send succeeds.
3. Worker retries the queue row.

**Expected (ideal):** WA once per order/notification type; push retries only.  
**Actual (code):** Another WA attempt for the same queue item.  
**Root cause:** WA delivery is not gated on prior successful `whatsapp_messages` / evidence for that `notification_queue_id`.  
**Blast radius:** Duplicate seller WhatsApp under load or flaky push - **pre-existing Meta behavior**, not introduced solely by Evolution, but still blocks production insistence #1.  
**Fix before Evolution live:** Skip WA if a non-failed outbound row already exists for `(notification_queue_id, provider)` or stamp `delivery_evidence.whatsapp.attempted_at` and skip when present (unless explicit audited retry flag in payload).  
**Verification:** Staging order with push blocked; count `whatsapp_messages` for that queue id across retries.

### F2 - High - Cross-provider retry re-queues entire notification (push + WA)

**Where:** [`evolution-go-admin/index.ts`](../../supabase/functions/evolution-go-admin/index.ts) `retry_failed_with_active_provider`

**Reproduction:**
1. Process an order notification to `processed` (push succeeded, WA failed or vice versa).
2. Admin invokes retry with new active provider.
3. Worker claims the row again.

**Expected:** WhatsApp-only retry under new provider; push untouched.  
**Actual:** Status → `pending`; full PNQ path runs (in-app insert deduped via `queue_item_id`, **push sends again**, WA sends again).  
**Root cause:** Retry mutates `notification_queue` instead of a WA-only outbox attempt.  
**Fix:** WA-only retry path (call adapter directly + audit) OR payload flag `whatsapp_only_retry: true` that skips push/in-app.  
**Verification:** After retry, push delivery count / device should not gain a second alert for the same order.

### F3 - High - Active Evolution + outage = intentional WA black hole

**Where:** [`whatsapp-provider.ts`](../../supabase/functions/_shared/whatsapp-provider.ts) - no fallthrough to Meta.

**Reproduction:** Set `active_provider=evolution_go` live; stop Docker / disconnect session; place order.

**Expected (product):** Push survives; WA may fail.  
**Actual:** Push OK; WA `provider_unavailable` / `session_disconnected`; Meta **not** used.  
**Assessment:** Correct vs dual-send rules; **incorrect** if product expectation was "never lose WA". Kill switch is the recovery.  
**Ops requirement:** Alert admins on Evolution disconnect while it is active; document that Meta must be restored for WA continuity.  
**Verification:** Order while Evolution down; confirm push; confirm no Meta `whatsapp_messages` row; kill switch; next order uses Meta.

### F4 - Medium - `delivery_evidence` WhatsApp stamp overwritten by push evidence

**Where:** PNQ writes WA evidence, then later `delivery_evidence: buildDeliveryEvidence(...)` **replaces** the JSON object without merging `whatsapp`.

**Impact:** Ops lose queue-level WA provider stamp (history still in `whatsapp_messages`). Does not drop notifications.  
**Fix:** Merge: `{ ...existing, ...buildDeliveryEvidence(...), whatsapp: existing.whatsapp }`.  
**Verification:** After successful push, `notification_queue.delivery_evidence` still contains `whatsapp.provider`.

### F5 - Medium - Deploy order hazard (new columns vs old schema)

**Where:** `logProviderWhatsAppMessage` inserts `provider`, `dry_run`, etc.

**Reproduction:** Deploy Edge Functions before migration (or rollback migration while new code runs).

**Impact:** Insert fails (logged); Meta/Evolution **send still attempted**. Logging gap only if caught - Meta path itself not aborted by log failure.  
**Safer order:** Migration first → deploy functions → keep Meta active.  
**Verification:** Apply migration on staging before function deploy; smoke Meta test panel.

### F6 - Medium - Webhook secret in query string

**Where:** Connect builds `...?secret=`; webhook accepts query or header.

**Impact:** Secret may appear in Evolution Go logs, proxy access logs, Referer.  
**Mitigation:** Prefer header if Evolution Go supports custom headers; rotate secret; restrict TLS access logs.  
**Verification:** Confirm secret not in third-party analytics; rotate after staging.

### F7 - Medium - Weak first-instance webhook allow

**Where:** `receive-evolution-go-webhook` allows events when `knownIds.size === 0`.

**Impact:** Before `provider_instance_id` is stored, any secret-bearer can post events. Secret still required.  
**Fix:** Require configured instance name match even when UUID missing; reject if no instance row.  
**Verification:** Delete instance rows; POST with valid secret; should 403 after fix.

### F8 - Medium - Admin direct UPDATE clears approval (bypasses RPC)

**Where:** Disconnect updates `whatsapp_provider_config` via service client, not RPC.

**Impact:** Correct intent (clear live approval) but bypasses audit shape of readiness RPC; partial audit via separate insert. RLS not involved (service role). Low abuse risk (admin JWT required).  
**Prefer:** Single RPC for disconnect side-effects.

### F9 - Low - In-memory webhook rate limit

Per Edge isolate; not global. Acceptable for v1; not a hard DoS control.

### F10 - Low - OpenAPI vs README path drift

Client uses OpenAPI (`/send/text`, `/instance/qr`). Wrong image tag → Evolution sends fail closed (good for Meta-active; bad if Evolution is active). Verify Swagger on pinned image before live.

### F11 - Low - RLS is select-only for admins

Writes go through SECURITY DEFINER RPCs or service role. No authenticated INSERT/UPDATE on config tables - **good**. Ensure no accidental GRANT to `anon`.

### F12 - Info - Dry-run as active provider

If `evolution_go` + `dry_run` is left active, sellers get **no real WA** (by design) while push works. Treat as staging-only; UI should warn.

---

## Concurrency / switch scenarios

| Scenario | Behavior | Damages Meta/push? |
|----------|----------|--------------------|
| Switch Meta→Evolution mid-batch | Each item loads config at WA time; mixed providers across items possible | No dual-send per item; no Meta damage |
| Kill switch during Evolution send | In-flight Evolution completes; next items Meta | No |
| Evolution timeout | WA fails; push continues | No |
| Duplicate webhook | Unique `(provider, event_dedupe_key)` | No order mutation |
| Invalid webhook secret | 403 | No |
| Order create with WA down | Order commits; enqueue works | No |

**Gap:** Provider is stamped in memory per attempt, not persisted on the queue row **before** send. Sufficient to prevent dual-send in one attempt; insufficient to prevent F1 re-send on later claims.

---

## Database integrity (migration review notes)

Before applying `20261103140000_whatsapp_provider_evolution_go.sql`:

1. Confirm singleton `whatsapp_provider_config` id=1, default `meta`.
2. Confirm admin RPCs use `is_admin(auth.uid())`; readiness update allows service_role (`auth.uid() IS NULL`).
3. Confirm `whatsapp_messages` status CHECK expansion is compatible with existing rows.
4. Confirm rollback script reviewed on a clone (does not drop Meta credentials).
5. Confirm no parallel `communication_outbox` was created (correct).

---

## Security summary

| Control | Present? |
|---------|----------|
| Frontend never gets Evolution API key | Yes |
| Admin JWT on `evolution-go-admin` | Yes |
| Webhook shared secret | Yes |
| Instance validation | Partial (F7) |
| Replay window | Yes (when timestamp present) |
| Dedup | Yes |
| Rate limit | Best-effort (F9) |
| Order mutation from WA text | Forbidden in code |
| Kill switch | Yes |

---

## Recommended staging sequence (do not skip)

1. Migration review (this doc + SQL).  
2. Apply migration; deploy Edge Functions; **leave Meta active**.  
3. Smoke: Meta Developer Tools test + one real order → Meta WA + push.  
4. Stand up Evolution Go; license; secrets; QR; webhook.  
5. Readiness gates + handset test message (do not claim pass without device).  
6. Staging only: Evolution dry_run then live; order lifecycle; multi-vendor.  
7. Failure: stop Evolution; confirm push; confirm no Meta silent send; kill switch; Meta resumes.  
8. Explicitly test F1/F2; patch before production Evolution.

---

## Go / no-go

| Decision | Recommendation |
|----------|----------------|
| Keep Meta production provider | **GO** |
| Staging validation | **GO** |
| Evolution Go production active | **NO-GO** until F1/F2 addressed or formally accepted, and handset E2E passes |
| Feature expansion | **STOP** - fix failure coupling first |

---

## Suggested minimal fixes (if authorized next)

1. PNQ: skip WhatsApp if successful prior attempt exists for `notification_queue_id` (unless `payload.force_whatsapp_retry === true`).  
2. Cross-provider retry: WA-only path; never reset push-processed rows to full reprocessing without an explicit "also retry push" flag.  
3. Merge WhatsApp into `delivery_evidence` on push completion updates.  
4. Tighten webhook when no `provider_instance_id` is registered.

No code changes were made in this audit pass.
