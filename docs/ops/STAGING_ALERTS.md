# Staging ops alerts (notification queue)

The `ops-alert-check` Edge Function watches `notification_queue` for worker backlogs. It is **auth-gated** (service-role bearer or `x-cron-secret` matching `CRON_SECRET`).

## What it checks

| Signal | Alert when |
|--------|------------|
| Pending count | `status = pending` and count **> 100** |
| Oldest pending age | Oldest pending row age **> 15 minutes** |

Response is always HTTP **200** when the check runs successfully. The JSON body includes `alerted: true` when either threshold is breached.

Optional: set `SENTRY_DSN` on the function to emit a Sentry warning when `alerted` is true.

## Deploy

```bash
supabase functions deploy ops-alert-check --project-ref wwuanzbusxoyzixuprxs
```

Set secrets in Supabase (Dashboard or CLI):

- `CRON_SECRET` - shared secret for cron invokers (required for pg_cron / external cron)
- `SENTRY_DSN` - optional ingest DSN for backlog warnings

## Cron invoke (every 5 minutes)

Use the project URL and anon key only as `apikey`; **do not** ship the service role to external schedulers. Prefer `x-cron-secret`.

```bash
curl -sS -X POST \
  "https://wwuanzbusxoyzixuprxs.supabase.co/functions/v1/ops-alert-check" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "x-cron-secret: ${CRON_SECRET}"
```

### Supabase pg_cron + pg_net (staging)

Store `CRON_SECRET` in Vault, then schedule:

```sql
SELECT cron.schedule(
  'ops-alert-check-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wwuanzbusxoyzixuprxs.supabase.co/functions/v1/ops-alert-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Adjust the URL if the staging project ref changes.

## Manual smoke

```bash
# Expect 401 without secret
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://wwuanzbusxoyzixuprxs.supabase.co/functions/v1/ops-alert-check"

# Expect 200 with JSON (alerted true/false)
curl -sS -X POST \
  "https://wwuanzbusxoyzixuprxs.supabase.co/functions/v1/ops-alert-check" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -H "apikey: ${SUPABASE_ANON_KEY}"
```

## Related

- `process-notification-queue` - drains pending rows; alert means this worker is behind or failing.
- `health` (service-role) - also exposes `notification_queue_pending` for dashboards.