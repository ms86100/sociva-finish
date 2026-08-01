# New Table Checklist

> Follow these steps every time you add a new table to the database.
> Last updated: 2026-02-14

---

## 1. Schema Design

- [ ] Add `id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY`
- [ ] Add `created_at timestamp with time zone NOT NULL DEFAULT now()`
- [ ] Add `updated_at timestamp with time zone` if the table supports updates
- [ ] Add `society_id uuid NOT NULL` if the data is society-scoped
- [ ] Add foreign key to `societies(id)` for `society_id`
- [ ] Add foreign key to `profiles(id)` for any user reference columns (NOT `auth.users`)
- [ ] Set appropriate column defaults and nullable constraints

## 2. Row Level Security

- [ ] `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;`
- [ ] Add SELECT policy scoped to `society_id = get_user_society_id(auth.uid())` or equivalent
- [ ] Add INSERT policy with `WITH CHECK` enforcing ownership (`user_id = auth.uid()`) and society scope
- [ ] Add UPDATE policy if updates are allowed, scoped appropriately
- [ ] Add DELETE policy if deletes are allowed, scoped appropriately
- [ ] Add admin fallback: `OR is_admin(auth.uid())` where appropriate
- [ ] Add society_admin access: `OR is_society_admin(auth.uid(), society_id)` for admin-managed tables
- [ ] Use RESTRICTIVE (`Permissive: No`) policies

## 3. Indexes

- [ ] Add composite index on `(society_id)` if society-scoped
- [ ] Add composite index on `(society_id, created_at DESC)` for time-ordered queries
- [ ] Add composite index on `(user_id, created_at DESC)` if user-scoped queries exist
- [ ] Add any additional indexes based on query patterns
- [ ] Document indexes in `.lovable/hardening-docs/index-registry.md`

## 4. Triggers

- [ ] Add `update_updated_at` trigger if table has `updated_at` column
- [ ] Add activity logging trigger if the table should appear in `society_activity`
- [ ] Wrap any new activity logging triggers in `BEGIN...EXCEPTION` blocks (log to `trigger_errors`)
- [ ] Document triggers in `.lovable/hardening-docs/trigger-registry.md`

## 5. Audit Logging

- [ ] Add `logAudit()` calls in frontend code for user-initiated actions
- [ ] Consider adding a database trigger for critical status changes
- [ ] Verify audit entries include: action, target_type, target_id, society_id

## 6. Documentation

- [ ] Update `.lovable/rls-policy-map.md` with new policies
- [ ] Update `.lovable/hardening-docs/role-access-matrix.md` with CRUD permissions per role
- [ ] Update `.lovable/hardening-docs/index-registry.md` with new indexes
- [ ] Update `.lovable/hardening-docs/trigger-registry.md` if triggers added

## 7. Verification

- [ ] Run the database linter to check for security warnings
- [ ] Verify RLS policies work for all 5 roles (buyer, seller, society_admin, builder_member, platform_admin)
- [ ] Verify cross-society isolation (user from Society A cannot see data from Society B)
- [ ] Test with deactivated admin to ensure revocation works

---

## Anti-Patterns to Avoid

- ❌ Foreign key to `auth.users` — use `profiles(id)` instead
- ❌ `USING (true)` on INSERT/UPDATE/DELETE policies
- ❌ Missing `society_id` on society-scoped data
- ❌ Silent trigger failures — always use `BEGIN...EXCEPTION` blocks
- ❌ Custom color classes in components — use semantic design tokens
