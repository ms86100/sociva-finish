# Staging schema sync (no production writes)

Staging project: `wwuanzbusxoyzixuprxs` (branch `onboarding-integration`)
Production project: `kkzkuyhgdvyecmxtmkpy` (never targeted by sync)

## Why not rebase alone

`rebase_branch` failed on the first missing migration (`user_feedback_profile_fkey`)
because staging had an orphaned `user_feedback` row. Heal data on staging, then
replay prod migration statements onto staging while recording the same
`schema_migrations.version` values.

## Safe rules

1. Only run DDL / data heals against `wwuanzbusxoyzixuprxs`.
2. Never `merge_branch` or `apply_migration` against production for this sync.
3. Prefer `execute_sql` on staging with the exact prod `version` + `name` insert
   so future rebase/diff stays aligned.
4. Frontend: `npm run dev:staging` / `npm run build:staging` (loads `.env.staging`).
