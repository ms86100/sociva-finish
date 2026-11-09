# Hostinger VPS deployment status (Evolution Go)

Date: 2026-11-03  
VPS: `srv2123279.hstgr.cloud` / `187.127.182.59`  
OS: Ubuntu 26.04.1 LTS (KVM 2: 2 vCPU, 7.7 GiB RAM, 96G disk)  
Deploy path: `/opt/sociva/evolution-go`

## Completed on VPS

| Item | Status |
|------|--------|
| VPS provisioned (India, Ubuntu 24.04 selected → panel installed 26.04 LTS) | Done |
| SSH key auth (`sociva_evolution_go_ed25519`) | Done |
| Docker CE 29.9.2 + Compose v5.7.0, enabled on boot | Done |
| Evolution Go image pinned | `evoapicloud/evolution-go@sha256:6fa601464bd76d3d19ece4c48d8bb5373d025d95d45b939ae4bf0c77b03f5aaa` |
| Postgres 15 (private Docker network only) | Healthy |
| Evolution Go on `127.0.0.1:8080` only | Running (`LICENSE_REQUIRED` until Manager activation) |
| Private webhook relay (no public ports) | Running |
| Caddy public front for `wa.sociva.in` | Running (ports 80/443); cert pending DNS |
| UFW: 22/80/443 only; Postgres/8080/8787 not public | Active |
| Named volumes preserved (never `down -v`) | `evolution_go_pg_data`, `evolution_go_data` |

## DNS (blocked - GoDaddy, not Hostinger)

`sociva.in` NS: `ns75.domaincontrol.com` / `ns76.domaincontrol.com` (GoDaddy).  
Hostinger domain portfolio has **no** `sociva.in`. Create this record in **GoDaddy DNS** only:

| Type | Name / Host | Value | TTL |
|------|-------------|-------|-----|
| A | `wa` | `187.127.182.59` | 600 |

Do **not** change: apex `sociva.in`, `www`, MX, SPF, DKIM, DMARC, Vercel records.

After DNS propagates, Caddy will issue Let's Encrypt for `https://wa.sociva.in`.

## Not done yet (approval gates)

1. Evolution Manager **license activation** (human; open `https://wa.sociva.in/manager/login` after DNS).  
2. Supabase Edge secrets (values generated on VPS; stored in agent store only - not in Git/chat).  
3. Production migrations `20261103140000` / `20261103150000` - inspect applied status first.  
4. Edge Function deploys.  
5. Admin QR pairing + handset E2E.  
6. Provider switch to Evolution - **forbidden until explicit approval**; Meta stays active.

## Local verification commands (after DNS)

```bash
dig +short wa.sociva.in
curl -sS https://wa.sociva.in/
# Expect LICENSE_REQUIRED JSON until license activated
```

## Architecture preserved

Vercel + Supabase unchanged. Hostinger runs Evolution Go + its Postgres + private relay + HTTPS only.
