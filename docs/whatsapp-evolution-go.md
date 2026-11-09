# Sociva WhatsApp providers (Meta + Evolution Go)

## Status

- **Production default:** Meta Cloud API (unchanged).
- **Optional alternate:** Evolution Go on a persistent VPS Docker host.
- **Rule:** Exactly one active provider for seller WhatsApp notifications.
- **Push:** Native FCM/APNs via `notification_queue` continues regardless of WhatsApp provider.
- **Channel independence (2026-11-03):** WhatsApp success is tracked on `notification_queue.whatsapp_status` and is not resent when push retries. Admin cross-provider retry is WhatsApp-only. See `docs/audits/WHATSAPP-CHANNEL-INDEPENDENCE-REMEDIATION.md`.

## Architecture

Order commit → `enqueue_seller_new_order_notification` → `notification_queue` → `process-notification-queue` → push + `deliverWhatsAppForQueueItem` → `whatsapp-provider` adapter → **active** provider only.

No parallel outbox. Failed WhatsApp attempts are **not** silently rerouted to the other provider. Explicit cross-provider retries are admin-only and audited (`retry_cross_provider`).

## Admin

**Admin → Communication Centre**

- Select Meta or Evolution Go (atomic + audited)
- Kill switch to Meta (no redeploy)
- Evolution QR connect / refresh / disconnect / health / status
- Readiness gates for live Evolution
- Ops dashboard (real `whatsapp_messages` aggregates)
- Message history + provider audit

Meta test panel remains under **Developer Tools** (Meta credentials only).

## Live Evolution activation gates

All required before `admin_set_whatsapp_provider('evolution_go', 'live')`:

1. Connected session
2. API health OK
3. Valid session
4. Successful real test message (not DB-only dry-run)
5. Webhook receipt verified
6. Explicit admin approval

## Edge secrets (Supabase)

| Secret | Purpose |
|--------|---------|
| `EVOLUTION_GO_BASE_URL` | HTTPS base URL of Evolution Go |
| `EVOLUTION_GO_API_KEY` | Same as Evolution `GLOBAL_API_KEY` |
| `EVOLUTION_GO_WEBHOOK_SECRET` | Shared secret for webhook |
| `EVOLUTION_GO_INSTANCE_NAME` | Default `sociva-primary` |

Never put these in frontend env.

## Webhook

`POST /functions/v1/receive-evolution-go-webhook?secret=...`

- Shared-secret validation
- Instance verification
- Replay window
- Deduplication (`communication_webhook_events`)
- Rate limiting
- **Informational only** - does not change order status

## Delivery honesty

HTTP acceptance from Evolution Go or Meta is **provider accepted**, not proof the seller saw the WhatsApp message. Delivered/read only when webhook receipts update `whatsapp_messages.status`. Do not mark real-device tests passed without handset evidence.

## Unofficial WhatsApp Web risk

Evolution Go uses whatsmeow (WhatsApp Web). Accounts can be limited or banned. Meta Cloud API is the compliant default. Keep Meta active until Evolution Go passes real-device testing.

## Deploy Evolution Go

See [infrastructure/evolution-go/README.md](../infrastructure/evolution-go/README.md).

## Migrations

- Forward: `supabase/migrations/20261103140000_whatsapp_provider_evolution_go.sql`
- Rollback: `supabase/rollbacks/20261103140000_whatsapp_provider_evolution_go.rollback.sql`

## Remaining human actions

1. Apply migration to the target Supabase project (review first).
2. Deploy Edge Functions: `evolution-go-admin`, `receive-evolution-go-webhook`, and updated `process-notification-queue` (+ shared modules).
3. Provision VPS; `docker compose up` under `infrastructure/evolution-go`.
4. Activate Evolution Go license in Manager UI.
5. Set Supabase Edge secrets listed above.
6. Admin → Communication Centre → Connect → scan QR.
7. Health + status + real test message + confirm webhook events.
8. Approve live; only then switch provider (staging first).
9. Keep Meta as production active until handset evidence passes.
10. Kill switch to Meta if Evolution becomes unstable.
