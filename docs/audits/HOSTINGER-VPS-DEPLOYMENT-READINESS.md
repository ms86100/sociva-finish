# Hostinger VPS deployment readiness report (Evolution Go for Sociva)

Date: 2026-11-03  
Scope: Phase 1 inspection before any Hostinger SSH, DNS change, Supabase migration apply, or Edge deploy  
Decision gate: **NO INFRASTRUCTURE CHANGES UNTIL THIS REPORT IS ACCEPTED AND CREDENTIALS PROVIDED**

## Architecture boundary (confirmed)

| Layer | Host | Change in this project? |
|-------|------|-------------------------|
| Frontend `sociva.in` | Vercel | **No** |
| Auth, DB, orders, payments, existing APIs | Supabase | **Only** approved secrets + optional migrations + Edge deploys |
| Meta WhatsApp + FCM/APNs | Existing Edge + Meta | **Preserve; Meta stays active provider** |
| Evolution Go + its Postgres + private webhook relay + HTTPS for `wa.sociva.in` | **Hostinger VPS only** | Deploy here |

```
Users → sociva.in → Vercel → Supabase (source of truth)
                              │
                              └── HTTPS → wa.sociva.in → Hostinger
                                           Evolution Go + Postgres + private relay
```

---

## What is already implemented in the repo

### Infrastructure templates (`infrastructure/evolution-go/`)

| Asset | Status |
|-------|--------|
| `docker-compose.yml` | Postgres + Evolution Go; `restart: unless-stopped`; volumes; healthchecks; bind `127.0.0.1:8080` |
| `docker-compose.relay.yml` | Private Caddy relay; **no public ports** |
| `Caddyfile.public-api` | HTTPS front for `wa.*` → `127.0.0.1:8080` |
| `Caddyfile.webhook-relay` | Inject `x-sociva-webhook-secret`; IP allowlist; forward to Supabase |
| `.env.example` | VPS env template |
| `init/01-create-databases.sh` | Creates `evogo_auth` / `evogo_users` |
| Image tag | **`evoapicloud/evolution-go:latest`** - must pin after first pull/Swagger verify |

### Supabase / Edge (code present; production apply status unknown)

| Asset | Status |
|-------|--------|
| Migrations `20261103140000`, `20261103150000` | Present + rollbacks - **not verified applied on live project** |
| `evolution-go-admin` | Admin JWT; connect/QR/status/test/kill switch; `EVOLUTION_GO_WEBHOOK_URL` override |
| `receive-evolution-go-webhook` | Header auth; reject query secrets; trusted instance; dedupe; no order mutations |
| `_shared/evolution-go.ts` | Client paths: `/instance/create`, `/instance/qr`, `/send/text`, … |
| `_shared/whatsapp-provider.ts` + `whatsapp-notify.ts` | Single active provider; Meta default |
| `_shared/whatsapp-channel.ts` | F1 claim / F2 WA-only retry support |
| `process-notification-queue` | Channel-independent evidence merge |
| Admin UI Communication Centre | QR connect / refresh / verify / kill switch |

### Secrets expected by code (exact names)

| Secret | Where | Expected value for Hostinger |
|--------|-------|------------------------------|
| `EVOLUTION_GO_BASE_URL` | Supabase Edge secrets | `https://wa.sociva.in` |
| `EVOLUTION_GO_API_KEY` | Supabase Edge secrets | Same as VPS `GLOBAL_API_KEY` |
| `EVOLUTION_GO_WEBHOOK_SECRET` | Supabase Edge **and** VPS relay env | Long random shared secret |
| `EVOLUTION_GO_INSTANCE_NAME` | Supabase Edge secrets | `sociva-primary` (default) |
| `EVOLUTION_GO_WEBHOOK_URL` | Supabase Edge secrets | `http://webhook-relay:8787/` (Docker DNS on VPS) |
| `GLOBAL_API_KEY`, `POSTGRES_*` | VPS `.env` only | Never in frontend / Git |

### Docs / audits already written

- `docs/whatsapp-evolution-go.md`
- `docs/whatsapp-evolution-go-e2e-checklist.md`
- `docs/evolution-go-staging-execution-guide.md`
- `docs/audits/WHATSAPP-EVOLUTION-GO-IMPLEMENTATION-AUDIT.md`
- `docs/audits/WHATSAPP-EVOLUTION-GO-ADVERSARIAL-AUDIT.md`
- `docs/audits/WHATSAPP-CHANNEL-INDEPENDENCE-REMEDIATION.md`
- `docs/audits/WHATSAPP-STAGING-DEPLOYMENT-READINESS.md`
- `docs/audits/EVOLUTION-GO-VPS-QR-E2E-AUDIT.md`

---

## What is incomplete / blocked (honest)

| Item | Status |
|------|--------|
| Hostinger VPS provisioned in repo | **Not done** - no SSH, no IP in repo |
| `wa.sociva.in` DNS | **Not done** - needs A record to VPS IP only |
| Evolution Go container running | **Not done** |
| License activation | **Human** on Manager UI |
| Image digest pinned | **Not done** (`:latest` still in compose) |
| Migrations applied on Supabase project | **Unknown** - must inspect before apply |
| Edge Functions deployed with new secrets | **Unknown** - need approval before production deploy |
| Live Swagger path verification | **Not done** until VPS up |
| Private relay live | **Not done** |
| QR paired + handset proof | **Not done** |
| Production `active_provider=evolution_go` | **Must remain false / meta** |

---

## Reliability rules (must preserve)

Already coded; do not regress:

1. Push continues if Evolution down.  
2. Meta = production default.  
3. Evolution staging-only until explicit approval.  
4. No dual-send / no silent provider switch.  
5. Queue idempotency + WA channel claim (F1).  
6. WhatsApp-only admin retry (F2).  
7. Separate push/WA evidence (F4).  
8. Kill switch to Meta without frontend redeploy.  

**Known residual (R1):** crash after WA send before `complete_*` can duplicate external WA after 60s lease - document in ops; do not claim exactly-once.

---

## Migration plan (approval required before apply)

1. Inspect live schema: `whatsapp_provider_config`, `communication_instances`, `notification_queue.whatsapp_status`.  
2. List applied migrations vs `20261103140000` / `20261103150000`.  
3. If missing: apply **in order** on staging first if available; production only with explicit approval.  
4. Confirm post-apply: `SELECT active_provider, evolution_mode FROM whatsapp_provider_config WHERE id=1` → `meta` / `disabled`.  
5. Never `reset`, never `down -v`, never drop unrelated tables.

---

## DNS record required (do not touch root)

When VPS public IP is known (`VPS_IP`):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **A** | `wa` | `<HOSTINGER_VPS_PUBLIC_IP>` | 300–3600 |

**Do not modify:** `sociva.in`, `www`, Vercel verification, MX, SPF/DKIM/DMARC.

---

## Hostinger deploy sequence (after credentials + approval)

1. SSH inspect VPS (Phase 2) - no overwrite of unrelated services.  
2. Install Docker if missing; enable on boot.  
3. Copy `infrastructure/evolution-go` → `/opt/sociva/evolution-go`.  
4. Configure `.env`; pin image digest after Swagger smoke.  
5. `docker compose up -d` then relay compose.  
6. Caddy public API for `wa.sociva.in`.  
7. License activate.  
8. DNS A for `wa`.  
9. Set Supabase secrets (values generated on VPS, not invented in chat).  
10. Ask approval → deploy Edge Functions / apply missing migrations.  
11. Keep Meta active; Admin QR pair; staging E2E; handset proof.  
12. Production Evolution activation only with explicit approval.

---

## Blockers requiring your input now

1. **SSH:** host/IP, username, auth method (key preferred). Password only via secure channel - do not paste into public chat if avoidable.  
2. **VPS public IP** (for DNS A record instructions).  
3. **DNS access:** Will you create the `wa` A record, or grant me access?  
4. **Supabase:** Confirm project ref (`kkzkuyhgdvyecmxtmkpy`?) and whether I may run read-only migration status.  
5. **Approval gates:** Confirm you want staging-first, Meta stays active, and no production provider switch without a later explicit yes.

---

## Phase 1 decision

| Question | Answer |
|----------|--------|
| Ready to SSH and inspect Hostinger? | **Only after you provide connection details** |
| Ready to change `sociva.in` / Vercel? | **No - out of scope** |
| Ready to apply production migrations now? | **No - inspect + your approval first** |
| Recreate Evolution integration from scratch? | **No - deploy existing templates** |
| Overall | **READY FOR PHASE 2 PENDING CREDENTIALS** |
