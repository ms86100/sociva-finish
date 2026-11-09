# Evolution Go: VPS independence, QR pairing & E2E execution audit

Date: 2026-11-03  
Method: Repository inspection + Evolution Foundation docs cross-check  
**Not claimed:** Live VPS deploy, license activation, handset delivery, Swagger of a pinned image

## Executive answer to your objective

| Objective | Verdict |
|-----------|---------|
| Scan QR once, power off Windows, keep receiving WA via VPS | **Architecturally supported** if you deploy the VPS stack + HTTPS + private webhook relay + Supabase secrets |
| Works today out of the box without a VPS | **No** - repo has templates and Edge/Admin code; **no live host is configured in-repo** |
| Production Evolution | **Forbidden** - Meta remains production provider |

---

## Phase 1 - Architecture trace

### Outbound (Admin → handset)

```
Admin UI (Communication Centre)
  → supabase.functions.invoke('evolution-go-admin')
  → Edge Function (service secrets: EVOLUTION_GO_BASE_URL, API_KEY, …)
  → HTTPS Evolution Go on VPS (must NOT be Windows localhost in staging)
  → WhatsApp linked-device session (whatsmeow)
  → Recipient handset
```

Order notifications (staging provider Evolution):

```
Buyer order commit
  → enqueue_seller_new_order_notification
  → notification_queue
  → process-notification-queue
  → deliverWhatsAppForQueueItem → adapter (active_provider)
  → Evolution POST /send/text
  → handset
```

### Inbound webhook

```
WhatsApp / Evolution Go
  → http://webhook-relay:8787/  (private Docker network)
  → inject x-sociva-webhook-secret
  → HTTPS Supabase receive-evolution-go-webhook
  → communication_webhook_events + readiness (no order mutations)
```

### Answers to Phase 1 checklist

| # | Question | Finding | Evidence |
|---|----------|---------|----------|
| 1 | Where hosted? | **Not hosted in repo.** Deploy target = your VPS using `infrastructure/evolution-go/` | compose + README |
| 2 | Compose permanent? | `restart: unless-stopped` on postgres + evolution-go | `docker-compose.yml` |
| 3 | Postgres persistent? | Named volume `evolution_go_pg_data` | compose volumes |
| 4 | WA auth/session store? | Configured via `POSTGRES_AUTH_DB` / `POSTGRES_USERS_DB`; optional mount `/evolution/data`. Official docs emphasize Postgres, not a documented session file path. **Must prove with restart test.** | `.env.example`, compose, Evolution install docs |
| 5 | Container recreate destroys session? | **No** if volumes kept (`down` without `-v`). **Yes** if `down -v` | README Rollback |
| 6 | VPS reboot restores? | Expected if Docker enabled on boot + volumes intact + `CONNECT_ON_STARTUP=true` | env + compose |
| 7 | QR workflow implemented? | Yes: create → connect → qr → admin image | `evolution-go-admin`, `AdminCommunicationCentre` |
| 8 | Admin shows actual QR? | Yes - `qrBase64` from Evolution response rendered as `<img>` | AdminCommunicationCentre.tsx |
| 9 | QR expire/refresh? | Refresh QR action; expire handling = regenerate via API (no local timer) | action `qr` |
| 10 | Status real? | Verify status polls Evolution; UI does not assume scan = connected | connect note + status action |
| 11 | Stable HTTPS to VPS? | Required via `EVOLUTION_GO_BASE_URL=https://…`; localhost only allowed for local Edge tests | `assertEvolutionGoBaseUrlSafe` |
| 12 | Windows/localhost dependency? | **Must not** for staging. If `EVOLUTION_GO_BASE_URL` points at Windows tunnel, Windows independence **fails** | secrets design |

---

## Phase 2 - QR pairing (A–I)

| | Answer |
|--|--------|
| **A** | Admin → **Communication Centre** (System nav). Not a separate route. |
| **B** | The WhatsApp account that will **send** (Linked Devices / staging business number). |
| **C** | Evolution pairs; webhook may emit PairSuccess/Connected; Admin still shows QR until Verify status. |
| **D** | Admin **Verify status** → Evolution status + DB `communication_instances`; webhooks can set readiness. |
| **E** | Evolution Postgres volumes (+ optional `/evolution/data`). Not on Windows. Not in Supabase. |
| **F** | Should not need rescan after `restart` if volumes persist - **prove on VPS**. |
| **G** | Should not after reboot if Docker starts + volumes OK - **prove on VPS**. |
| **H** | Disconnected status; Admin Reconnect/QR; or kill switch to Meta for notifications. |
| **I** | Yes - Admin Connect/Reconnect without app redeploy. |

---

## Phase 3 - VPS independence

| Check | Repo state |
|-------|------------|
| Compose / restart policy | Present |
| Postgres volume | Present |
| Extra data volume | Present (`/evolution/data`) - **unverified vs image internals** |
| Env | `.env.example` |
| Firewall / TLS / DNS | Documented; operator must configure |
| Healthcheck | Present on both services |
| `CONNECT_ON_STARTUP` | Default true |
| Logs | json-file rotation |
| Resources | 512M postgres / 1G app |
| Backup | pg_dumpall + volume snapshot instructions |

**Windows independence:** After pairing, only VPS (Evolution + relay) + Supabase (Edge + DB) + WhatsApp cloud are required. Cursor/Windows can be off.

---

## Phase 4 - Webhook security

| Control | Status |
|---------|--------|
| Query secret rejected | Yes |
| Header secret required | Yes |
| Trusted instance required | Yes (`webhook_trusted`) |
| Dedup / replay | Yes |
| No order mutation | Yes |
| Open secret injector | **Must avoid** - use `docker-compose.relay.yml` (no public ports) |
| Prior Caddy sketch | Replaced with deployable private relay + public API Caddyfiles |

`EVOLUTION_GO_WEBHOOK_URL` (Edge secret) lets Connect register `http://webhook-relay:8787/` so Evolution on the VPS hits the private injector; relay forwards to Supabase with header.

---

## Phase 5–7

Executable steps: [`docs/evolution-go-staging-execution-guide.md`](../evolution-go-staging-execution-guide.md)

---

## API path risk (do not ignore)

Installation docs still show create/`qrcode` shapes that differ from OpenAPI used in Sociva (`/instance/qr`, `/send/text`, create `{ name }`).

**Mandatory first VPS action:** open `https://wa…/swagger/index.html` and align if needed before blaming Sociva.

---

## Decision for execution

| Item | Decision |
|------|----------|
| Proceed to VPS deploy + QR + handset | **Yes (staging)** |
| Claim E2E already works | **No** |
| Activate Evolution in production | **No** |
