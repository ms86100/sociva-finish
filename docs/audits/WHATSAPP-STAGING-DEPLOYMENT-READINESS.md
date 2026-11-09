# Final WhatsApp staging deployment readiness audit

Date: 2026-11-03  
Scope: Post F1/F2/F4/F6/F7 remediation  
Method: Static code + migration inspection + automated contract tests  
**Not executed here:** Supabase migration apply, Edge Function deploy, concurrent staging workers, real handsets  

Constraints (unchanged):
- Meta = production / default `active_provider`
- Evolution Go = staging-only until handset + staging proof

---

## Final decision

# READY WITH CONDITIONS

The repository is **implementation-complete enough for controlled staging preparation** (migration review → deploy → Meta-active smoke → Evolution staging behind a hardened relay).

It is **not** proven production-ready for Evolution Go, and **not** fully proven for staging until the conditions below are cleared on a real environment.

Do **not** treat 17/17 automated tests as deployed-system reliability.

---

## Evidence legend

| Tag | Meaning |
|-----|---------|
| **STATIC** | Source / SQL inspection only |
| **AUTO** | Vitest contract tests executed in this workspace |
| **STAGING** | Requires deployed Supabase + functions (not done here) |
| **DEVICE** | Requires real WhatsApp / push handsets (not done here) |

Automated re-run this audit: `npx vitest run src/test/notification-channel-independence.test.ts src/test/whatsapp-provider-evolution-go.test.ts` → **17 PASS / 0 FAIL** (**AUTO**).

---

## A. Database review (**STATIC**)

### Migration order

| Order | File | Depends on |
|-------|------|------------|
| 1 | `20261103140000_whatsapp_provider_evolution_go.sql` | Existing `is_admin`, `whatsapp_messages`, `notification_queue` |
| 2 | `20261103150000_notification_channel_independence.sql` | `communication_instances`, `whatsapp_provider_config`, `whatsapp_provider_audit` from (1) |

Rollback order must be **reverse**: `20261103150000` rollback, then `20261103140000` rollback.

### Defaults / Meta safety

- Singleton `whatsapp_provider_config` seeds `active_provider='meta'`, `evolution_mode='disabled'`.
- No migration flips production to Evolution.

### Unique constraints / concurrency

| Safeguard | Assessment |
|-----------|------------|
| `claim_whatsapp_channel_delivery` uses `FOR UPDATE` | Prevents concurrent claim races while row locked |
| Skip when `whatsapp_status IN ('sent','provider_accepted')` | Blocks F1 resend after successful complete |
| 60s `processing` lease | Second worker skips while first holds claim |
| Unique index `whatsapp_messages_success_once_per_queue` | DB backstop against duplicate **log** rows |

**Residual risk (CONDITION R1):** If a worker **sends WhatsApp successfully** then **crashes before** `complete_whatsapp_channel_delivery`, status can remain `processing`. After the 60s lease, another worker may **claim again and send a second WhatsApp**. The unique index only suppresses a second *log* row; it does not stop a second provider send. Staging must measure this (kill worker mid-flight) or accept a follow-up hardening (pre-send check of successful `whatsapp_messages` for that queue id).

### `whatsapp_status` transitions (**STATIC**)

Allowed: `NULL → processing → {sent|provider_accepted|failed|skipped|dry_run}`; admin retry → `pending` → `processing` → …

Invalid values rejected by CHECK. Force retry can reclaim after success (intentional, audited).

### Admin retry vs push (**STATIC**)

`admin_request_whatsapp_only_retry` updates only:
- `whatsapp_status`, `whatsapp_error`, `whatsapp_updated_at`, `payload` flags  

Does **not** set `status='pending'` or clear `processed_at`. Edge admin path sets `whatsappOnly` / `pushUntouched` and calls WA adapter directly.

### RLS / grants (**STATIC**)

| Object | Client | Service |
|--------|--------|---------|
| Provider/config/audit/instances/webhook tables | Admin SELECT only | Service role bypasses RLS |
| Admin RPCs (`set_provider`, kill switch, WA-only retry) | `authenticated` + `is_admin` | N/A / as designed |
| `claim_*` / `complete_*` | **Not** granted to authenticated | `service_role` only |
| Readiness update | Admin or service (`auth.uid()` null allowed) | Used by webhook |

No authenticated INSERT/UPDATE policies on config tables (writes via SECURITY DEFINER / service).

### Rollback safety (**STATIC**)

- `20261103150000` rollback drops new functions/columns/index; leaves Meta path intact.
- `20261103140000` rollback drops provider tables; leaves additive `whatsapp_messages` columns (documented). Apply on clone before production use.

---

## B. Notification processing scenarios

| # | Scenario | Expected | Proven how | Result |
|---|----------|----------|------------|--------|
| 1 | WA succeeds, push fails | WA not resent on push retry; push may retry | **STATIC** claim skip + **AUTO** contracts | Code PASS; **STAGING** required for DB evidence |
| 2 | Push succeeds, WA fails | WA can retry; push not forced by WA admin retry | **STATIC** F2 path | Code PASS; **STAGING** required |
| 3 | Both succeed, worker restart | No duplicate WA if status completed | **STATIC** | Code PASS; crash-before-complete = R1 |
| 4 | Two workers same item | One claim; other `in_progress` / success skip | **STATIC** FOR UPDATE | Code PASS; **STAGING** concurrent proof pending |
| 5 | Two admins same WA retry | Second duplicate within 10m window suppressed | **STATIC** audit idempotency | Code PASS; **STAGING** pending |
| 6 | Provider switch mid-batch | Per-attempt stamp; no dual-send in one attempt | **STATIC** | Code PASS; **STAGING** pending |
| 7 | Evolution unavailable | Fail closed if Evolution active; push continues | **STATIC** | Code PASS; keep Meta active in staging smoke |
| 8 | Meta kill switch | `active_provider=meta` without redeploy | **STATIC** RPC + UI | Code PASS; **STAGING** pending |

**Database evidence required in staging (not available in this audit):**

```sql
-- After scenario 1 (WA ok, push retried):
SELECT id, status, whatsapp_status, whatsapp_attempt_count,
       delivery_evidence->'whatsapp', delivery_evidence->'push'
FROM notification_queue WHERE id = '<id>';

SELECT count(*) FROM whatsapp_messages
WHERE notification_queue_id = '<id>' AND dry_run = false
  AND status IN ('sent','provider_accepted','delivered','read');
-- expect 1

SELECT active_provider, evolution_mode FROM whatsapp_provider_config WHERE id = 1;
-- expect meta / disabled for production-like smoke
```

---

## C. Webhook security (**STATIC** + **AUTO**)

| Check | Evidence | Result |
|-------|----------|--------|
| Query secrets rejected | `query_secret_rejected`; no secret values logged (path only) | PASS (**STATIC**/AUTO) |
| Missing/wrong header rejected | 403 `forbidden`; logs `hasHeader` bool only | PASS (**STATIC**) |
| Unregistered / untrusted instance | Requires `webhook_trusted=true` + id/name match | PASS (**STATIC**/AUTO) |
| Dedup | Unique `(provider, event_dedupe_key)` | PASS (**STATIC**) |
| Replay window | Rejects stale timestamps when present | PASS (**STATIC**); weak if payload has no timestamp |
| Secrets in logs | Connect URL has no query secret; webhook redacts URL | PASS (**STATIC**) |
| Reverse proxy bypass | See section D | **CONDITION R2** |

---

## D. Reverse proxy checklist (Evolution → Sociva)

Evolution Go does **not** document custom outbound webhook headers. Sociva **requires** `x-sociva-webhook-secret` (or matching `apikey`).

### Do not

- Expose a public URL that injects the Sociva webhook secret into **every** inbound POST.
- Put the secret in the Evolution `webhookUrl` query string (Sociva rejects it).
- Log request headers containing the secret.

### Do (recommended relay pattern)

1. Deploy a private relay (same VPS as Evolution, or locked VPC) listening only on Evolution’s Docker network / localhost / allowlisted IP.
2. Evolution `webhookUrl` → `https://relay.internal/evo-webhook` (or HTTP on private network only).
3. Relay authenticates the **caller**:
   - Prefer source IP = Evolution container/host bridge IP, **and/or**
   - mTLS / shared network-only bind (no public 0.0.0.0), **and/or**
   - Verify Evolution instance id against allowlist before forward.
4. Relay injects `x-sociva-webhook-secret: $EVOLUTION_GO_WEBHOOK_SECRET`.
5. Relay forwards POST to  
   `https://<project>.supabase.co/functions/v1/receive-evolution-go-webhook` over HTTPS.
6. Relay strips/does not forward Evolution-origin secrets; does not echo Sociva secret in responses/logs.
7. Firewall: public internet cannot hit the inject-secret hop.
8. Rotate `EVOLUTION_GO_WEBHOOK_SECRET` in Supabase + relay together.

### Minimal Caddy sketch (private listener only)

```caddy
# Bind to private interface only - NOT a public open injector
:8787 {
  @fromEvo remote_ip 172.16.0.0/12 10.0.0.0/8 127.0.0.1
  handle @fromEvo {
    reverse_proxy https://kkzkuyhgdvyecmxtmkpy.supabase.co {
      header_up Host {upstream_hostport}
      header_up x-sociva-webhook-secret {$EVOLUTION_GO_WEBHOOK_SECRET}
      header_up instanceId {http.request.header.instanceId}
      rewrite * /functions/v1/receive-evolution-go-webhook
    }
  }
  respond "forbidden" 403
}
```

Validate in staging: public curl without secret → 403; Evolution via relay → 200; query `?secret=` → 403.

---

## E. Regression (**STATIC**)

| Area | Assessment |
|------|------------|
| Order create / multi-vendor enqueue | Untouched by these migrations |
| Meta `whatsapp.ts` / `send-whatsapp` | Intact; adapter defaults Meta |
| FCM/APNs PNQ path | Still runs after WA; WA errors caught |
| Seller prefs (`notification_preferences.whatsapp`) | Still gated in `shouldSendWhatsApp` |
| Meta as default | Seeded; kill switch present |

No **STAGING** Meta regression run in this audit.

---

## F. Conditions before calling staging “validated”

| ID | Condition | Owner |
|----|-----------|-------|
| C1 | Apply migrations in order on staging; confirm `active_provider='meta'` | Ops |
| C2 | Deploy PNQ + shared modules + `evolution-go-admin` + `receive-evolution-go-webhook` | Ops |
| C3 | Meta smoke: order → push + Meta WA (or skip WA if Meta creds absent, but push must work) | QA |
| C4 | Hardened relay deployed; public bypass test fails | Ops |
| C5 | Scenarios 1–8 executed with SQL evidence | QA |
| C6 | Concurrent double-claim test | QA |
| C7 | Real handset WA + push proof (DEVICE) | QA |
| C8 | Evolution stop → push continues; kill switch → Meta | QA |
| R1 | Accept or patch crash-before-complete WA duplicate window | Eng |
| R2 | Relay must not be an open secret injector | Ops |

---

## What this audit explicitly does **not** claim

- Deployed staging reliability  
- Real-device delivery  
- Production Evolution activation  
- That automated tests alone prove readiness  

---

## Recommended next milestone (unchanged)

Controlled staging demo only:

1. Place order → seller push + WhatsApp  
2. Break one channel → other unaffected  
3. Recover without duplicates  
4. Keep Meta active throughout production  

No further feature work on this integration until that demo is evidenced.
