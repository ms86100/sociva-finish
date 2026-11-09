# Evolution Go staging execution guide (practical)

**Goal:** Scan QR once → VPS keeps WhatsApp session → Windows can power off → Sociva still sends WA (staging only).

**Hard rules:** Meta stays production `active_provider`. Evolution Go is staging-only. Verify Swagger on your deployed image before trusting any path.

---

## Honest preflight (repo facts)

| Fact | Status |
|------|--------|
| Evolution Go running on a VPS today | **Not in this repo** - only templates under `infrastructure/evolution-go/` |
| Docker Compose for permanent ops | Yes - `restart: unless-stopped`, named volumes |
| Admin QR UI | Yes - Admin → Communication Centre |
| Windows required after pairing | **No** - VPS + Supabase only |
| Webhook header injection | Requires private relay (`docker-compose.relay.yml`) or equivalent |

API paths used by Sociva code (`supabase/functions/_shared/evolution-go.ts`):

- `POST /instance/create` body `{ name }`
- `POST /instance/connect` (+ `instanceId` header)
- `GET /instance/qr`
- `GET /instance/status` (fallback `/instance/{name}/status`)
- `POST /send/text`

Official install docs also mention older paths (`/instance/{name}/qrcode`, create with `instanceName`). **After deploy, open Swagger and confirm.** Prefer live Swagger over README.

---

## STEP 1 - What to configure on the VPS

1. Ubuntu 22.04+ VPS (1–2 GB RAM minimum; docs say ≥512 MB).
2. Install Docker Engine + Compose v2.
3. Domain DNS: `wa.your-domain.com` → VPS public IP (for HTTPS API).
4. Open firewall: `22`, `80`, `443` only. Do **not** publish `8080` publicly (compose binds `127.0.0.1:8080`).
5. Copy `infrastructure/evolution-go/` to the VPS, e.g. `/opt/sociva/evolution-go/`.

---

## STEP 2 - Deploy Evolution Go

```bash
ssh user@YOUR_VPS
cd /opt/sociva/evolution-go
cp .env.example .env
# Edit GLOBAL_API_KEY, POSTGRES_PASSWORD, and matching POSTGRES_*_DB URLs

docker compose up -d
docker compose ps
curl -sS http://127.0.0.1:8080/
```

Install Caddy (or Nginx) for public HTTPS to the API using `Caddyfile.public-api`:

```bash
export EVOLUTION_PUBLIC_HOST=wa.your-domain.com
# install caddy; point config at Caddyfile.public-api
sudo caddy run --config /opt/sociva/evolution-go/Caddyfile.public-api
# or caddy start / systemd
```

Activate license: open `https://wa.your-domain.com/manager/login` → API URL + `GLOBAL_API_KEY` → Magic Link / OAuth. Until activated, API may return **503**.

---

## STEP 3 - Environment variables (where)

### On VPS (`/opt/sociva/evolution-go/.env`)

| Variable | Purpose |
|----------|---------|
| `GLOBAL_API_KEY` | Evolution API auth |
| `POSTGRES_PASSWORD` + DB URLs | Persistent Postgres |
| `CONNECT_ON_STARTUP=true` | Reconnect WA after container start |
| `CLIENT_NAME` | Client id |

### On same VPS for relay (`.env` or shell)

| Variable | Purpose |
|----------|---------|
| `EVOLUTION_GO_WEBHOOK_SECRET` | Injected by relay (same value as Supabase) |
| `SUPABASE_FUNCTIONS_HOST` | e.g. `kkzkuyhgdvyecmxtmkpy.supabase.co` |

```bash
docker compose -f docker-compose.yml -f docker-compose.relay.yml up -d
```

### In Supabase (Edge Function secrets) - NOT on Windows permanently

```bash
supabase secrets set \
  EVOLUTION_GO_BASE_URL=https://wa.your-domain.com \
  EVOLUTION_GO_API_KEY='<same as GLOBAL_API_KEY>' \
  EVOLUTION_GO_WEBHOOK_SECRET='<long random>' \
  EVOLUTION_GO_INSTANCE_NAME=sociva-primary \
  EVOLUTION_GO_WEBHOOK_URL=http://webhook-relay:8787/ \
  --project-ref kkzkuyhgdvyecmxtmkpy
```

**Note:** `EVOLUTION_GO_WEBHOOK_URL=http://webhook-relay:8787/` only works if Evolution resolves that hostname (same Docker network). Sociva Admin Connect passes this URL to Evolution. Evolution (on VPS) POSTs to the relay; relay injects header and forwards to Supabase. **Windows is not in this path.**

If `EVOLUTION_GO_WEBHOOK_URL` is unset, Connect points Evolution at the public Edge Function URL and webhooks will **403** unless another header-injecting hop exists.

Also deploy Edge Functions: `evolution-go-admin`, `receive-evolution-go-webhook`, `process-notification-queue`, and shared modules. Apply migrations `20261103140000` then `20261103150000`.

---

## STEP 4 - Verify Docker, Postgres, volumes

```bash
docker compose ps
docker compose exec postgres pg_isready -U postgres
docker volume ls | grep evolution
docker volume inspect evolution-go_evolution_go_pg_data
docker volume inspect evolution-go_evolution_go_data

# Confirm CONNECT_ON_STARTUP
docker compose exec evolution-go printenv CONNECT_ON_STARTUP
# expect true

# Swagger (verify real paths for THIS image)
curl -sS -o /dev/null -w "%{http_code}\n" https://wa.your-domain.com/swagger/index.html
```

**Persistence honesty:** Official Evolution Go compose persists **Postgres** (`POSTGRES_AUTH_DB` / `POSTGRES_USERS_DB`). Sociva compose also mounts `evolution_go_data:/evolution/data` as an extra bet. WhatsApp linked-device material for whatsmeow is expected primarily in Postgres when those DBs are configured. **Confirm after your first pair** by restarting the container without `-v` and checking status still connected. Do not assume the extra volume alone is enough; do not assume deleting volumes keeps the session.

What survives / dies:

| Event | Postgres volume kept | `/evolution/data` kept | Session likely |
|-------|----------------------|------------------------|----------------|
| `docker compose restart` | yes | yes | yes if CONNECT_ON_STARTUP + DB |
| `docker compose down` (no `-v`) | yes | yes | yes after `up` |
| `docker compose down -v` | **destroyed** | **destroyed** | **gone - rescan QR** |
| VPS reboot | yes (disk) | yes | yes if Docker enabled on boot |
| New VPS without volume restore | lost | lost | rescan |

---

## STEP 5 - Admin URL for QR (actual implementation)

1. Open Sociva web/admin (your staging/prod frontend).
2. Sign in as **admin**.
3. Open **Admin**.
4. Sidebar → **System** → **Communication Centre** (`activeTab=communication-centre` in [`AdminPage.tsx`](../src/pages/AdminPage.tsx) / [`AdminSidebarNav.tsx`](../src/components/admin/AdminSidebarNav.tsx)).
5. Evolution Go card → **Connect WhatsApp**.

There is no separate `/admin/communication` route; it is an Admin tab.

Confirm Edge sees secrets: Communication Centre should not show “Evolution Go Edge secrets are not configured”.

---

## STEP 6 - Scan the QR

1. Click **Connect WhatsApp** (creates/retrieves instance, calls connect + QR).
2. If QR blank/expired, click **Refresh QR**.
3. On the **phone that owns the Sociva staging business WhatsApp** (Linked Devices account - typically the same business number you intend to send from):
   - WhatsApp → Settings → Linked Devices → Link a Device
   - Scan the QR shown in Admin
4. Do **not** use a personal test phone as the *sender* unless that is intentional for staging.

---

## STEP 7 - Confirm pairing succeeded

1. In Admin → **Verify status** (calls `action=status`). Expect Connected.
2. Check Admin readiness gates (connected / health / session).
3. Optional on VPS / Swagger: instance status connected.
4. Sociva DB: `communication_instances.connection_status` / `webhook_trusted=true`.
5. Webhook path: after pairing, events should mark `readiness_webhook_ok` when relay works.

Sociva does **not** treat QR display as connected. Code comment: “Status Connected only after verification.”

---

## STEP 8 - Send a real test message

1. Communication Centre → Test WhatsApp message.
2. Phone: recipient digits with country code (e.g. `91XXXXXXXXXX`) - a phone that can receive from the linked account.
3. **Send real test** (not dry-run).
4. Confirm on the **recipient handset**.
5. Record `providerMessageId`, time, and Admin message history row.

HTTP accept ≠ delivery. Handset sighting is required to claim pass.

---

## STEP 9 - Staging Sociva order (normal queue)

**Keep production Meta.** On **staging** project only, after readiness + admin approve live:

1. Admin → set provider **Evolution Go** / mode **live** (blocked until gates + approval).
2. Place a real buyer order in the normal Sociva checkout (COD or paid flow that reaches `placed`).
3. Confirm `notification_queue` row for the seller (`type=order`, `target_role=seller`).
4. Confirm PNQ runs; `whatsapp_status` / `whatsapp_messages.provider='evolution_go'`.
5. Seller handset: WhatsApp arrives; push arrives independently (FCM/APNs).
6. Inspect `delivery_evidence` for separate `push` and `whatsapp` keys.

Do not bypass `create_multi_vendor_orders` / enqueue for this test.

When done, **kill switch / set Meta** again so staging does not leave Evolution as default accidentally.

---

## STEP 10 - Windows independence proof

After pairing + one successful test:

1. Close Cursor / browser (optional).
2. **Shut down the Windows PC.**
3. From phone or another machine, place another staging order **or** trigger Admin test message via a phone browser logged into Admin (or curl with admin JWT from a laptop that is not your Windows box - VPS `curl` to Evolution `/send/text` also proves VPS path).
4. Recipient must still get WhatsApp.

If this fails, the dependency is still on a local tunnel/Windows process - fix `EVOLUTION_GO_BASE_URL` to the VPS HTTPS host.

---

## STEP 11 - Docker restart and VPS reboot

### Docker restart

```bash
cd /opt/sociva/evolution-go
docker compose restart evolution-go
sleep 20
curl -sS http://127.0.0.1:8080/
# Admin → Verify status; send another real test message
```

**Expected:** No new QR if session restored. If QR required again, session did not persist - check Postgres volumes and Swagger/logs; do not delete volumes.

### VPS reboot

```bash
sudo reboot
# after SSH back:
docker compose -f /opt/sociva/evolution-go/docker-compose.yml -f /opt/sociva/evolution-go/docker-compose.relay.yml ps
# Ensure Docker enabled: sudo systemctl is-enabled docker
```

Then Admin Verify status + real test message again.

### Failure recovery

1. `docker compose stop evolution-go`
2. Place staging order with Evolution still active on staging → push should continue; WA fail recorded; **no silent Meta**.
3. `docker compose start evolution-go`
4. Admin WA-only retry if needed - must not re-fire push.
5. Confirm production/staging `active_provider` Meta on production project.

---

## QR pairing FAQ (explicit)

| Q | A |
|---|---|
| A. Where is QR? | Admin → Communication Centre → Connect / Refresh QR |
| B. Which WhatsApp scans? | The **sender** Linked Devices account (staging business WA) |
| C. After scan? | Evolution emits connection events; Admin Verify status → Connected |
| D. How Sociva knows? | `action=status` + webhook connection events + `communication_instances` |
| E. Session stored? | Primarily Evolution Postgres volumes; optional `/evolution/data` mount - **verify with restart test** |
| F. Rescan after Docker restart? | Should not, if volumes kept + CONNECT_ON_STARTUP |
| G. Rescan after VPS reboot? | Should not, if Docker starts and volumes intact |
| H. If WA disconnects? | Status disconnected; reconnect/QR in Admin; kill switch to Meta for notifications |
| I. Reconnect without redeploy? | Yes - Admin Connect/Reconnect/Refresh QR |

**QR pairing ≠ keeping VPS running.** Pairing is one-time (until logout/ban/volume wipe). The **VPS must stay up** for sends.

---

## Automated vs manual tests

| Automated (repo) | Needs VPS / handset |
|------------------|---------------------|
| Compose restart policy, volumes, CONNECT_ON_STARTUP present | Live health, license, Swagger |
| Admin tab + QR invoke paths in source | Actual QR image + scan |
| Webhook rejects query secret / untrusted instance | Live relay forward |
| WA channel claim / no push on WA retry | Concurrent workers on staging DB |
| Provider default Meta | Real order + handset delivery |

Contract tests: `src/test/whatsapp-provider-evolution-go.test.ts`, `src/test/notification-channel-independence.test.ts`, `src/test/evolution-go-vps-persistence.test.ts`.
