# WhatsApp Evolution Go implementation audit

Date: 2026-11-03  
Scope: repository implementation of multi-provider WhatsApp (Meta default + Evolution Go alternate)  
Method: source review. No production migration applied by this change set. No real-device WhatsApp delivery claimed.

## Verdict

Implementation is **code-complete for offline/credential-free paths**. Meta remains default. Production Evolution Go live send requires human VPS + license + QR + secrets + handset evidence.

## Safeguards present

| Requirement | Evidence |
|-------------|----------|
| Single active provider | `whatsapp_provider_config`, adapter refuses inactive provider |
| Meta default | Seed + DEFAULT `meta` |
| No parallel outbox | Extends `notification_queue` / PNQ only |
| Kill switch without redeploy | `admin_rollback_whatsapp_provider_to_meta` + Admin UI |
| Provider stamp on attempts | `whatsapp_messages.provider`, `delivery_evidence.whatsapp` |
| No silent reroute | Adapter + audited `retry_cross_provider` only |
| Readiness gates for live | Migration + Admin UI approval |
| Webhook hardening | secret, instance, replay, dedupe, rate limit, no order mutations |
| Push preserved | PNQ push path unchanged aside from WA evidence merge |
| HTTP ≠ delivery | `provider_accepted`, `delivery_confirmed: false` |

## Findings

### F1 - Medium - Live Swagger path drift
Evolution Go README vs OpenAPI disagree on some paths (`/message/sendText` vs `/send/text`). Client uses OpenAPI paths with a status fallback. **Action:** after VPS deploy, verify Swagger and adjust `evolution-go.ts` if needed.

### F2 - Medium - In-memory webhook rate limit
Rate limiting is per Edge isolate (best-effort). **Action:** acceptable for v1; consider Durable/Redis if abuse appears.

### F3 - Low - Admin Communication Centre requires migration + function deploy
UI will error until migration and `evolution-go-admin` are deployed. Meta Developer Tools panel remains usable.

### F4 - Info - Real-device tests not run
No handset evidence in this change set. Do **not** flip production `active_provider` to `evolution_go`.

## Regression risk to Meta

Meta modules (`whatsapp.ts`, `send-whatsapp`, `receive-whatsapp-webhook`) left intact. Queue WA path now goes through adapter which defaults to Meta when config missing or `active_provider=meta`.

## Remaining human actions

See `docs/whatsapp-evolution-go.md` section "Remaining human actions".
