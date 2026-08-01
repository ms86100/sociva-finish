# RLS Test Plan — Per-Role Validation Queries

> Run these queries via Cloud SQL editor to validate RLS isolation per role.
> Replace UUIDs with real test data from your environment.

## Setup: Test Users

| Role | Description | How to identify |
|---|---|---|
| `buyer` | Regular resident | Has profile, no entry in `user_roles` or `society_admins` |
| `seller` | Approved vendor | Has `user_roles.role = 'seller'` + `seller_profiles` entry |
| `society_admin` | Committee member | Has entry in `society_admins` with `deactivated_at IS NULL` |
| `builder_member` | Builder org member | Has entry in `builder_members` |
| `platform_admin` | Sociva team | Has `user_roles.role = 'admin'` |

---

## Test 1: Cross-Society Data Isolation

**Goal**: A buyer in Society A must NOT see data from Society B.

```sql
-- As buyer from Society A, try to read Society B's bulletin posts
-- Expected: 0 rows returned
SELECT * FROM bulletin_posts WHERE society_id = '<SOCIETY_B_ID>';

-- As buyer from Society A, try to read Society B's dispute tickets
-- Expected: 0 rows returned
SELECT * FROM dispute_tickets WHERE society_id = '<SOCIETY_B_ID>';

-- As buyer from Society A, try to read Society B's help requests
-- Expected: 0 rows returned
SELECT * FROM help_requests WHERE society_id = '<SOCIETY_B_ID>';
```

## Test 2: Society Admin Scope

**Goal**: A society admin for Society A cannot modify Society B data.

```sql
-- As society_admin of Society A, try to approve a user in Society B
-- Expected: 0 rows updated
UPDATE profiles SET verification_status = 'approved'
WHERE id = '<USER_IN_SOCIETY_B>' AND society_id = '<SOCIETY_B_ID>';

-- As society_admin of Society A, try to update Society B settings
-- Expected: 0 rows updated
UPDATE societies SET auto_approve_residents = true
WHERE id = '<SOCIETY_B_ID>';

-- As society_admin of Society A, try to insert admin in Society B
-- Expected: RLS violation error
INSERT INTO society_admins (society_id, user_id, role, appointed_by)
VALUES ('<SOCIETY_B_ID>', '<ANY_USER>', 'admin', auth.uid());
```

## Test 3: Commerce Isolation

**Goal**: Orders are scoped to seller's society.

```sql
-- Verify order gets society_id from seller
INSERT INTO orders (buyer_id, seller_id, total_amount)
VALUES ('<BUYER_ID>', '<SELLER_ID>', 100);
-- Check: society_id should be auto-populated
SELECT id, society_id FROM orders WHERE buyer_id = '<BUYER_ID>' ORDER BY created_at DESC LIMIT 1;
```

## Test 4: Builder Access

**Goal**: Builder members can only see their assigned societies.

```sql
-- As builder_member, try to read an unassigned society's builder_societies
-- Expected: 0 rows
SELECT * FROM builder_societies WHERE builder_id = '<OTHER_BUILDER_ID>';

-- As builder_member, try to modify builders table
-- Expected: RLS violation (only platform admins can write)
UPDATE builders SET name = 'Hacked' WHERE id = '<ANY_BUILDER_ID>';
```

## Test 5: Privilege Escalation Prevention

**Goal**: No role can escalate without platform admin.

```sql
-- As buyer, try to insert into user_roles
-- Expected: RLS violation
INSERT INTO user_roles (user_id, role) VALUES (auth.uid(), 'admin');

-- As society_admin, try to insert into user_roles
-- Expected: RLS violation
INSERT INTO user_roles (user_id, role) VALUES (auth.uid(), 'admin');

-- As society_admin, try to appoint admin beyond max limit
-- Expected: Trigger raises exception
-- (Requires max_society_admins already reached)
```

## Test 6: Audit Log Integrity

**Goal**: Audit logs are append-only for users, readable by admins.

```sql
-- As buyer, try to read audit logs
-- Expected: 0 rows (not admin or society admin)
SELECT * FROM audit_log;

-- As any user, try to update audit log
-- Expected: RLS violation (no UPDATE policy)
UPDATE audit_log SET action = 'tampered' WHERE id = '<ANY_LOG_ID>';

-- As any user, try to delete audit log
-- Expected: RLS violation (no DELETE policy)
DELETE FROM audit_log WHERE id = '<ANY_LOG_ID>';
```

## Test 7: Last Admin Protection

**Goal**: Cannot remove the last active admin from a society.

```sql
-- As society_admin (the ONLY admin), try to self-deactivate
-- Expected: Exception "Cannot remove the last society admin"
UPDATE society_admins SET deactivated_at = now()
WHERE user_id = auth.uid() AND society_id = '<SOCIETY_ID>';
```

---

## Automated Validation Checklist

| # | Test | Role | Expected | Pass? |
|---|---|---|---|---|
| 1 | Cross-society bulletin read | buyer | 0 rows | |
| 2 | Cross-society dispute read | buyer | 0 rows | |
| 3 | Cross-society user approval | society_admin | 0 updated | |
| 4 | Cross-society settings update | society_admin | 0 updated | |
| 5 | Order society_id auto-fill | buyer | Populated | |
| 6 | Builder cross-read | builder_member | 0 rows | |
| 7 | Self-escalation to admin | buyer | RLS error | |
| 8 | Audit log tamper | any | RLS error | |
| 9 | Last admin removal | society_admin | Trigger error | |
| 10 | Platform admin can remove last admin | platform_admin | Success | |
