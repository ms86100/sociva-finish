# RLS Policy & Security Architecture Documentation

> Last updated: 2026-02-14

## Security Definer Functions (Access Control)

| Function | Purpose | Called By |
|---|---|---|
| `has_role(uuid, user_role)` | Checks `user_roles` table for role membership | `is_admin()` |
| `is_admin(uuid)` | Shorthand for `has_role(uid, 'admin')` | Most RLS policies |
| `get_user_society_id(uuid)` | Returns user's `society_id` from `profiles` | Society-scoped SELECT policies |
| `is_society_admin(uuid, uuid)` | Checks `society_admins` OR `is_admin()` | Society governance policies |
| `is_builder_member(uuid, uuid)` | Checks `builder_members` OR `is_admin()` | Builder-scoped policies |
| `can_manage_society(uuid, uuid)` | `is_society_admin()` OR builder member of owning builder | Combined admin check |
| `get_user_auth_context(uuid)` | Returns all auth data in one call (profile, society, roles, sellers, admin, builders) | AuthContext frontend |

## Authorization Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `user_roles` | Global role assignment (buyer, seller, admin) | `user_id`, `role` |
| `society_admins` | Society-scoped admin delegation | `user_id`, `society_id`, `role`, `deactivated_at` |
| `builder_members` | Builder org membership | `user_id`, `builder_id`, `role` |

## Table → Policy Map

### Governance Tables (Society Admin Access)

| Table | SELECT | INSERT | UPDATE | DELETE | Admin Function Used |
|---|---|---|---|---|---|
| `profiles` | Own + admin | Auth trigger | Own + `is_society_admin()` | — | `is_society_admin` |
| `seller_profiles` | Society-scoped | Own | Own + `is_society_admin()` | — | `is_society_admin` |
| `societies` | Public (active) | Authenticated | `is_admin()` + `is_society_admin()` | — | Both |
| `society_admins` | Same society members | `is_society_admin()` | — | — | `is_society_admin` |
| `dispute_tickets` | Submitter + society admin | Own society | Society admin | — | `is_society_admin` |
| `dispute_comments` | Via ticket access | Via ticket access | — | — | `is_society_admin` |
| `emergency_broadcasts` | Society members | Society admin | — | Society admin | `is_society_admin` |
| `maintenance_dues` | Resident + admin | Society admin | Society admin | Society admin | `is_society_admin` |
| `construction_milestones` | Society members | Society admin | Society admin | Society admin | `is_society_admin` |
| `expense_flags` | Flagger + admin | Society members | Society admin | — | `is_society_admin` |
| `audit_log` | Admin + society admin | Own (actor_id) | — | — | `is_society_admin` |

### Commerce Tables (User-Scoped)

| Table | SELECT | INSERT | UPDATE | DELETE | Society Isolation |
|---|---|---|---|---|---|
| `orders` | Buyer + seller + admin | Buyer | Buyer + seller + admin | — | `society_id` auto-populated via trigger |
| `order_items` | Via order access | Via order ownership | — | — | Inherited from order |
| `products` | Approved sellers' products | Seller owns | Seller owns | Seller owns | Via `seller_profiles.society_id` |
| `cart_items` | Own | Own | Own | Own | ⚠️ No society isolation |
| `favorites` | Own | Own | — | Own | ⚠️ No society isolation |
| `payment_records` | Buyer + seller + admin | Buyer | Buyer + admin | — | ⚠️ No society isolation |
| `coupons` | Active in society | Seller owns | Seller owns | — | `society_id` |

### Community Tables (Society-Scoped)

| Table | SELECT | INSERT | UPDATE | DELETE | Isolation Method |
|---|---|---|---|---|---|
| `bulletin_posts` | Society members | Own society | Author + admin | Author + admin | `society_id` |
| `bulletin_comments` | Via post society | Via post society | — | Author + admin | Via `bulletin_posts` |
| `bulletin_votes` | Via post society | Via post society | — | Own | Via `bulletin_posts` |
| `bulletin_rsvps` | Via post society | Via post society | Own | Own | Via `bulletin_posts` |
| `help_requests` | Society members | Own society | Author + admin | Author + admin | `society_id` |
| `help_responses` | Requester + responder | Own society | — | Own | Via `help_requests` |

### Builder Tables (Platform Admin Only for Writes)

| Table | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `builders` | Members + admin | Platform admin only |
| `builder_members` | Same builder members | Platform admin only |
| `builder_societies` | Builder members | Platform admin only |

## Known Gaps (Tracked)

| Gap | Risk | Status |
|---|---|---|
| `cart_items` no society isolation | Cross-society cart possible | Phase 4 |
| `favorites` no society isolation | Can favorite cross-society sellers | Phase 4 |
| `payment_records` no society isolation | Financial data not scoped | Phase 4 |
| `reviews` no society isolation | Reviews span societies | Phase 4 |
| `reports`/`warnings` global | Society admins can't moderate | Phase 5 |

## Composite Indexes for RLS Performance

```sql
idx_dispute_tickets_society_status (society_id, status)
idx_dispute_tickets_society_created (society_id, created_at DESC)
idx_snag_tickets_society_status (society_id, status)
idx_society_expenses_society_created (society_id, created_at DESC)
idx_construction_milestones_society (society_id, created_at DESC)
idx_user_roles_user_role (user_id, role)
idx_profiles_society_verification (society_id, verification_status)
idx_seller_profiles_society_verification (society_id, verification_status)
idx_orders_society (society_id)
idx_orders_buyer_status (buyer_id, status)
idx_orders_seller_status (seller_id, status)
idx_audit_log_society (society_id, created_at DESC)
```

## Triggers

| Trigger | Table | Function | Purpose |
|---|---|---|---|
| `trg_auto_approve_resident` | `profiles` | `auto_approve_resident()` | Auto-sets verification_status if society has auto_approve |
| `trg_set_order_society_id` | `orders` | `set_order_society_id()` | Derives society_id from seller on INSERT |
| `trg_validate_society_admin_limit` | `society_admins` | `validate_society_admin_limit()` | Enforces max_society_admins cap |
| Activity triggers (7) | Various | `log_*_activity()` | Writes to `society_activity` |
| `check_seller_license_trigger` | `products` | `check_seller_license()` | Validates license before product creation |
| Rating/count triggers | Various | `update_*()` | Maintains denormalized counts |
