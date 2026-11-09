# Evolution Go deployment (Sociva)

Persistent WhatsApp Web engine for Sociva's **optional** Evolution Go provider.
Meta Cloud API remains the default production WhatsApp provider in Sociva.

## Requirements

- Docker 20.10+ and Docker Compose v2
- VPS or persistent Docker host (not Vercel / not Supabase Edge)
- HTTPS reverse proxy (Caddy or Nginx) terminating TLS
- Evolution Go license activation (human step via Manager UI)

## Quick start

```bash
cd infrastructure/evolution-go
cp .env.example .env
# Edit GLOBAL_API_KEY and POSTGRES_PASSWORD (and derived DB URLs)

docker compose up -d
docker compose ps
curl -sS http://127.0.0.1:8080/
```

Open Swagger: `https://your-wa-host/swagger/index.html` and **verify** paths for create, QR, status, send text against that image. Prefer OpenAPI over README if they disagree.

## License activation (required)

1. Open `https://your-wa-host/manager/login`
2. Enter API URL and `GLOBAL_API_KEY`
3. Complete Magic Link / OAuth license activation
4. Until activated, API calls may return HTTP 503

## Connect WhatsApp (QR)

Prefer Sociva Admin → Communication Centre (server-side). Manual check:

```bash
# Paths must match live Swagger for your image tag
curl -X POST https://your-wa-host/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: $GLOBAL_API_KEY" \
  -d '{"name":"sociva-primary"}'

# Connect with Sociva webhook URL (NO secret in query string)
curl -X POST https://your-wa-host/instance/connect \
  -H "Content-Type: application/json" \
  -H "apikey: $GLOBAL_API_KEY" \
  -H "instanceId: <instance-uuid>" \
  -d '{
    "webhookUrl":"https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/receive-evolution-go-webhook",
    "subscribe":["ALL"],
    "immediate":true
  }'
```

### Webhook authentication (required)

Sociva rejects query-string secrets. The Edge Function requires header:

`x-sociva-webhook-secret: <EVOLUTION_GO_WEBHOOK_SECRET>`

Evolution Go does not document custom outbound headers. Use the **private** relay on the same Docker network (no public ports):

```bash
export EVOLUTION_GO_WEBHOOK_SECRET=...
export SUPABASE_FUNCTIONS_HOST=kkzkuyhgdvyecmxtmkpy.supabase.co
docker compose -f docker-compose.yml -f docker-compose.relay.yml up -d
```

Set Supabase secret `EVOLUTION_GO_WEBHOOK_URL=http://webhook-relay:8787/` so Admin Connect registers that URL with Evolution. The relay injects the header and forwards HTTPS to Supabase. **Do not** expose an open public injector.

Public API TLS: `Caddyfile.public-api` (terminates HTTPS to `127.0.0.1:8080`).

Scan Linked Devices QR from Admin → Communication Centre. Confirm with **Verify status**. Admin Connect marks the instance `webhook_trusted`.

Full runbook: [`docs/evolution-go-staging-execution-guide.md`](../../docs/evolution-go-staging-execution-guide.md).

## Sociva Edge secrets

Set in Supabase (Dashboard → Edge Functions → Secrets):

| Secret | Value |
|--------|-------|
| `EVOLUTION_GO_BASE_URL` | `https://your-wa-host` (HTTPS only) |
| `EVOLUTION_GO_API_KEY` | Same as `GLOBAL_API_KEY` |
| `EVOLUTION_GO_WEBHOOK_SECRET` | Long random shared secret |
| `EVOLUTION_GO_INSTANCE_NAME` | `sociva-primary` (default) |

Keep Sociva on **Meta** until real-device Evolution tests pass.

## Kill switch

Admin → Communication Centre → **Rollback to Meta** (RPC `admin_rollback_whatsapp_provider_to_meta`). No Sociva redeploy required.

## Restart / recovery

```bash
docker compose restart evolution-go
# CONNECT_ON_STARTUP=true should restore sessions from Postgres volumes
```

## Backup

```bash
docker compose exec postgres pg_dumpall -U postgres > evolution-go-backup.sql
# Also snapshot named volumes evolution_go_pg_data and evolution_go_data
```

## Rollback (host)

```bash
docker compose down
# To wipe sessions (destructive): docker compose down -v
```

## Unofficial WhatsApp Web risk

Evolution Go uses whatsmeow (WhatsApp Web). Numbers can be limited or banned. Meta Cloud API is the compliant production default. See `docs/whatsapp-evolution-go.md`.
