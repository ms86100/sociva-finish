# WhatsApp / Push channel independence remediation

Date: 2026-11-03  
Follows: `WHATSAPP-EVOLUTION-GO-ADVERSARIAL-AUDIT.md`  
Constraint: Meta remains production provider. Evolution Go staging-only.

## Files / objects changed

| Area | Path |
|------|------|
| Migration | `supabase/migrations/20261103150000_notification_channel_independence.sql` |
| Rollback | `supabase/rollbacks/20261103150000_notification_channel_independence.rollback.sql` |
| Channel helpers | `supabase/functions/_shared/whatsapp-channel.ts` |
| WA deliver | `supabase/functions/_shared/whatsapp-notify.ts` |
| Provider log | `supabase/functions/_shared/whatsapp-provider.ts` |
| PNQ | `supabase/functions/process-notification-queue/index.ts` |
| Admin retry / connect | `supabase/functions/evolution-go-admin/index.ts` |
| Webhook | `supabase/functions/receive-evolution-go-webhook/index.ts` |
| Instance upsert | `supabase/functions/_shared/evolution-go.ts` |
| Contract tests | `src/test/notification-channel-independence.test.ts` |

## Root cause → remediation

### F1 - Push retry resends WhatsApp
**Before:** Every PNQ claim ran `deliverWhatsAppForQueueItem`, including push-only retries.  
**After:** `claim_whatsapp_channel_delivery` + `notification_queue.whatsapp_status`; successful states (`sent` / `provider_accepted`) skip send. Unique index on successful `whatsapp_messages` per queue id.  
**Limitation:** Explicit admin `force_whatsapp_retry` may send again by design.

### F2 - Cross-provider retry resends push
**Before:** Admin retry set queue `status=pending` and cleared `processed_at` → full PNQ including FCM/APNs.  
**After:** `admin_request_whatsapp_only_retry` resets **WhatsApp columns only**; admin handler calls WA adapter directly with `forceWhatsAppRetry`; push status untouched; duplicate admin clicks suppressed via audit idempotency key.  
**Limitation:** Does not create a separate background WA worker for orphaned `whatsapp_status=pending` if the admin invoke crashes after RPC and before send - re-click admin retry (idempotent window) or call action again.

### F4 - Evidence overwrite
**Before:** `delivery_evidence: buildDeliveryEvidence(push)` replaced the JSON.  
**After:** `mergeDeliveryEvidence` keeps nested `whatsapp` while updating nested `push`.

### F6 - Secret in query
**Before:** Connect URL included `?secret=`.  
**After:** Header-only auth (`x-sociva-webhook-secret` / `apikey` / Bearer). Query `secret`/`token` → 403.  
**Ops requirement:** Evolution Go outbound webhooks do not document custom headers. Staging/production must inject `x-sociva-webhook-secret` via reverse proxy in front of the Edge Function URL (documented in `infrastructure/evolution-go/README.md`).

### F7 - First-instance allow
**Before:** Empty instance registry allowed any event with valid secret.  
**After:** Require `communication_instances.webhook_trusted=true` and matching instance id/name. Admin Connect sets trusted.

## Regression scenarios (expected behaviour)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Push OK, WA fail, queue retries | Push may retry; WA may retry while `whatsapp_status=failed`; no success→success duplicate |
| 2 | WA OK, push fail, queue retries | WA skipped (`already_succeeded`); push retries only |
| 3 | Both OK, worker restart | Reclaim of processed row should not occur; if reclaimed incorrectly, WA still skipped |
| 4 | Two workers same item | Claim lease / success-once index prevents double live WA |
| 5 | Admin WA retry other provider | WA-only; push not fired; audit row |
| 6 | Evolution unavailable | WA fails closed; push unaffected when Meta not active… if Evolution active |
| 7 | Kill switch to Meta | Next WA uses Meta; prior success still skipped |
| 8 | Duplicate webhook | 200 `duplicate: true` |
| 9 | Unregistered instance | 403 `unknown_instance` |
| 10 | Invalid webhook auth / query secret | 403 |

## Automated tests executed

```
npx vitest run src/test/notification-channel-independence.test.ts
npx vitest run src/test/whatsapp-provider-evolution-go.test.ts
```

Results recorded in the agent session after this document was written.

## Acceptance

- [x] F1 code+migration  
- [x] F2 WA-only admin retry  
- [x] F4 evidence merge  
- [x] F6 header auth + query reject  
- [x] F7 trusted instance  
- [ ] Staging live E2E with real devices (not claimed here)  
- [ ] Evolution production activation (explicitly blocked)

## Remaining limitations

1. Reverse proxy required for Evolution → Sociva webhook header injection.  
2. Full physical separation of push vs WA workers is incremental; shared queue remains with independent status columns.  
3. Real-device and concurrent worker proof requires staging deploy + migration apply.
