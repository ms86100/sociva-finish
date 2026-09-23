# Staging TestFlight ≠ Production Supabase

**Hard rule:** Codemagic workflow `ios-testflight-staging` embeds staging Supabase only. Workflow `ios-release` embeds production only. Production project `kkzkuyhgdvyecmxtmkpy` is never modified by TestFlight testing.

## Environments

| Role | Codemagic workflow | Supabase | Who uses it |
|------|--------------------|----------|-------------|
| Production | `ios-release` | `https://kkzkuyhgdvyecmxtmkpy.supabase.co` | App Store / existing users |
| Staging / TestFlight QA | `ios-testflight-staging` | `https://wwuanzbusxoyzixuprxs.supabase.co` (branch `onboarding-integration`) | You + small tester group |

Staging app markers:

- Home-screen name: **Sociva Staging**
- Amber in-app banner: `STAGING BUILD · …supabase.co · not production`
- Console: `[Supabase] env=staging host=wwuanzbusxoyzixuprxs.supabase.co`

## Build TestFlight against staging

1. In Codemagic, start workflow **`ios-testflight-staging`** (not `ios-release`).
2. Build fails closed if `VITE_SUPABASE_URL` is not the staging host (`scripts/assert-supabase-env.cjs --require-staging`).
3. Upload IPA to App Store Connect / Internal Testing as usual.
4. Invite only your tester group. Do not submit this build as the production App Store release.

## Local staging web / Capacitor

```bash
cp .env.staging.example .env.staging.local
# fill VITE_SUPABASE_PUBLISHABLE_KEY from staging dashboard (anon)
# then:
set -a && source .env.staging.local && set +a
node scripts/assert-supabase-env.cjs --require-staging
npm run build
```

## Database / RPC / RLS during testing

- Apply migrations **only** to staging project `wwuanzbusxoyzixuprxs` (or Supabase branch `onboarding-integration`).
- Never run `apply_migration` / `db push` against `kkzkuyhgdvyecmxtmkpy` while validating.
- If staging breaks, production users are unaffected.

## Promote staging → production (after mobile OK)

One command for the plan (safe dry-run):

```bash
node scripts/promote-staging-backend.cjs
```

Apply only after explicit approval:

```bash
node scripts/promote-staging-backend.cjs --confirm-production --apply
```

That script lists the exact migration files to promote. Prefer applying those files to production (MCP `apply_migration` with `project_id: kkzkuyhgdvyecmxtmkpy`) rather than a blind `merge_branch`, so unrelated branch history cannot land in prod.

Then:

1. Verify on production: `select to_regclass('public.app_installations');`
2. Ship the app with Codemagic **`ios-release`** (production keys).
3. Stop distributing **Sociva Staging** TestFlight builds to non-testers.

## Rollback

- **App:** Expire / stop testing the staging TestFlight build; production App Store binary still points at production Supabase.
- **Backend:** Do not merge staging blindly. If a promoted migration must be reversed, ship a new down-migration to production only after review - staging remains the sandbox.

## Quick checklist before trusting a TestFlight build

- [ ] Built with `ios-testflight-staging`
- [ ] CI log shows `✅ Staging Supabase locked: https://wwuanzbusxoyzixuprxs.supabase.co`
- [ ] Device shows **Sociva Staging** + amber banner
- [ ] Device console / diagnostics host is `wwuanzbusxoyzixuprxs`
- [ ] Production dashboard shows no new test traffic from your devices
