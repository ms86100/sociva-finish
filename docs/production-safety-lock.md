# Production safety lock — permission lifecycle

**Last verified:** 2026-09-22

## Hard locks (do not violate)

| Surface | Production ID | Status |
|---|---|---|
| Supabase main | `kkzkuyhgdvyecmxtmkpy` (`Sociva`) | **NOT migrated** — `app_installations` absent |
| Vercel production | `sociva.in` / `sociva-finish` | **NOT deployed** — no `--prod` |
| App `.env` | points at production URL for local web | Unchanged; used for read-only browsing only |

## Isolated validation performed

1. **Supabase branch** `onboarding-integration` (`wwuanzbusxoyzixuprxs`)
   - Applied `app_installations_permission_lifecycle`
   - Validated `upsert_app_installation` → row `e2e-test-install-0001` with `location=denied`, `notif=not_requested`, `user_id` null
   - Validated `release_app_installation_user` keeps same `installation_id`
   - `claim_device_token` left intact; `device_tokens.installation_id` column added
2. **Vercel preview only** on project `sociva-integration`
   - URL: `https://sociva-integration-3owhkoam8-sagar-sharmas-projects-8c6f93f2.vercel.app`
   - Target: preview (`target: null`, not production)
   - OG verified via `vercel curl`: `/api/share/product/test` returns proper `og:title` / `og:image:secure_url` HTML
3. **Production re-check after all of the above**
   - `kkzkuyhgdvyecmxtmkpy`: `app_installations` = false, `upsert_app_installation` = false
   - `sociva.in` production alias not updated
