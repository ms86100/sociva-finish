# Evolution Go E2E checklist (manual)

Do not mark any real-world WhatsApp delivery row as **Pass** without handset evidence.
Keep `active_provider=meta` in production until this checklist passes on staging.

| # | Scenario | Steps | Expected | Actual | Source / endpoint | DB evidence | Pass/Fail |
|---|----------|-------|----------|--------|-------------------|-------------|-----------|
| 1 | QR generation | Admin → Communication Centre → Connect | QR image shown | | `evolution-go-admin` action=connect /qr | `communication_instances.last_qr_at` | |
| 2 | Connection | Scan Linked Devices; Verify status | `connected` | | action=status | readiness_connected=true | |
| 3 | Session after restart | `docker compose restart evolution-go` | Still connected or recoverable | | status | last_connected_at | |
| 4 | Disconnect | Disconnect in Admin | disconnected; live approval cleared | | action=disconnect | connection_status | |
| 5 | Reconnect | Connect + scan | connected again | | action=connect | audit reconnect | |
| 6 | Test message | Send real test; check phone | Handset receives text | | action=test_message | whatsapp_messages provider=evolution_go | |
| 7 | Health | Health check | readiness_health_ok | | action=health | | |
| 8 | Webhook | Trigger any WA event | 200; webhook_ok | | receive-evolution-go-webhook | communication_webhook_events | |
| 9 | Dry-run mode | set_provider evolution_go dry_run; place order | Queue WA dry_run / no seller WA live | | PNQ + adapter | whatsapp_messages.dry_run=true | |
| 10 | Live blocked without gates | try set live without approval | RPC error | | admin_set_whatsapp_provider | | |
| 11 | Order notify Meta | active=meta; place order | Meta path + push | | PNQ | provider=meta; push processed | |
| 12 | Missing phone | seller without phone | WA skip no_phone; push continues | | PNQ logs | | |
| 13 | Duplicate order event | re-enqueue same idempotency | no duplicate WA spam | | notification_queue unique | | |
| 14 | Evolution down | stop container; active=evolution live | WA fail provider_unavailable; push OK | | adapter | status=failed | |
| 15 | Kill switch | Kill switch to Meta | active=meta immediately | | admin_rollback… | audit kill_switch_meta | |
| 16 | Cross-provider retry | explicit retry action | audited; uses new provider | | retry_failed_with_active_provider | audit retry_cross_provider | |
| 17 | Duplicate webhook | replay same event | duplicate=true 200 | | webhook | unique dedupe | |
| 18 | Bad webhook secret | wrong secret | 403 | | webhook | | |
| 19 | Non-admin UI | seller JWT invoke admin fn | 403 | | evolution-go-admin | | |
| 20 | Multi-vendor | cart two sellers | one queue row per seller | | enqueue | | |
| 21 | Migration rollback | apply rollback SQL on clone | tables/RPCs dropped; Meta code still works | | rollback file | | |

## Definition of done (production Evolution)

- [ ] VPS Evolution Go healthy + license activated
- [ ] All readiness gates green + admin approved
- [ ] Real handset received test message
- [ ] Staging order notify verified on handset
- [ ] Kill switch tested
- [ ] Production still on Meta until explicitly approved
