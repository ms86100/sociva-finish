# Trigger & Security Definer Function Registry

> Complete inventory of all database triggers and SECURITY DEFINER functions.
> Last updated: 2026-02-14

---

## SECURITY DEFINER Functions (Access Control)

| Function | Returns | Purpose | Side Effects | Error Handling |
|---|---|---|---|---|
| `has_role(uuid, user_role)` | boolean | Check role in `user_roles` | None (read-only) | Returns false on miss |
| `is_admin(uuid)` | boolean | Shorthand for `has_role(uid, 'admin')` | None | Returns false |
| `get_user_society_id(uuid)` | uuid | Get user's society from `profiles` | None | Returns NULL if no profile |
| `is_society_admin(uuid, uuid)` | boolean | Check `society_admins` + fallback to `is_admin()` | None | Returns false |
| `is_builder_member(uuid, uuid)` | boolean | Check `builder_members` + fallback to `is_admin()` | None | Returns false |
| `can_manage_society(uuid, uuid)` | boolean | `is_society_admin()` OR builder member of owning builder | None | Returns false |
| `get_user_auth_context(uuid)` | jsonb | All auth data in one call | None (read-only) | Returns `{profile: null}` if no user |
| `get_builder_dashboard(uuid)` | jsonb | Builder's societies with aggregate counts | None (read-only) | Returns empty structure |
| `search_marketplace(text, uuid?)` | TABLE | Full-text seller/product search | None | Returns empty set |
| `calculate_trust_score(uuid)` | numeric | Compute trust score for a user | None | Returns 0 on no data |
| `calculate_society_trust_score(uuid)` | numeric | Compute trust score for a society | None | Returns capped at 10.0 |
| `refresh_all_trust_scores()` | void | Batch update all society trust scores | WRITES to `societies` | Silent on failure |
| `get_category_parent_group(text)` | text | Lookup parent group for a category | None | Returns NULL |

## SECURITY DEFINER Functions (Triggers)

| Function | Attached To | Timing | Purpose | Side Effects | Error Handling |
|---|---|---|---|---|---|
| `auto_approve_resident()` | `profiles` INSERT | BEFORE | Auto-set verification if society allows | Modifies NEW row | Silent (returns NEW) |
| `set_order_society_id()` | `orders` INSERT | BEFORE | Derive society_id from seller | Modifies NEW row | Silent (returns NEW) |
| `validate_society_admin_limit()` | `society_admins` INSERT | BEFORE | Enforce max_society_admins | None | RAISES EXCEPTION on limit |
| `protect_last_society_admin()` | `society_admins` UPDATE | BEFORE | Prevent removing last admin | None | RAISES EXCEPTION if last admin |
| `check_seller_license()` | `products` INSERT/UPDATE | BEFORE | Validate seller has approved license | None | RAISES EXCEPTION if no license |
| `update_seller_rating()` | `reviews` INSERT | AFTER | Recalculate seller avg rating | WRITES to `seller_profiles` | Silent |
| `update_bulletin_comment_count()` | `bulletin_comments` INSERT/DELETE | AFTER | Inc/dec comment_count | WRITES to `bulletin_posts` | Silent |
| `update_bulletin_vote_count()` | `bulletin_votes` INSERT/DELETE | AFTER | Inc/dec vote_count | WRITES to `bulletin_posts` | Silent |
| `update_help_response_count()` | `help_responses` INSERT/DELETE | AFTER | Inc/dec response_count | WRITES to `help_requests` | Silent |
| `update_endorsement_count()` | `skill_endorsements` INSERT/DELETE | AFTER | Update endorsement + trust score | WRITES to `skill_listings` | Silent |
| `log_expense_activity()` | `society_expenses` INSERT | AFTER | Log to society_activity | WRITES to `society_activity` | Silent |
| `log_dispute_activity()` | `dispute_tickets` INSERT | AFTER | Log to society_activity | WRITES to `society_activity` | Silent |
| `log_document_activity()` | `project_documents` INSERT | AFTER | Log to society_activity | WRITES to `society_activity` | Silent |
| `log_broadcast_activity()` | `emergency_broadcasts` INSERT | AFTER | Log to society_activity | WRITES to `society_activity` | Silent |
| `log_answer_activity()` | `project_answers` INSERT | AFTER | Log to society_activity | WRITES to `society_activity` | Silent |
| `log_milestone_activity()` | `construction_milestones` INSERT | AFTER | Log to society_activity | WRITES to `society_activity` | Silent |
| `log_snag_activity()` | `snag_tickets` INSERT | AFTER | Log to society_activity | WRITES to `society_activity` | Silent |
| `update_updated_at()` | Multiple tables | BEFORE UPDATE | Set updated_at = now() | Modifies NEW row | Silent |

---

## Trigger Execution Order

PostgreSQL does not guarantee trigger execution order for same-timing triggers on the same table. Current tables with multiple triggers:

| Table | Triggers | Risk |
|---|---|---|
| `products` | `check_seller_license` (BEFORE), `update_updated_at` (BEFORE) | Low — independent concerns |
| `bulletin_comments` | `update_bulletin_comment_count` (AFTER) | None — single trigger |
| `society_admins` | `validate_society_admin_limit` (BEFORE INSERT), `protect_last_society_admin` (BEFORE UPDATE) | None — different operations |

## Known Risks

1. **Silent failures**: All `log_*_activity()` triggers fail silently. If `society_activity` table has schema issues, activity logging stops without alerts.
2. **Cascading writes**: `update_endorsement_count` triggers `calculate_trust_score` which queries multiple tables — performance concern at scale.
3. **No trigger monitoring**: No mechanism to detect trigger failures in production.

## Monitoring Recommendations

```sql
-- Check for trigger execution errors in Postgres logs
SELECT * FROM postgres_logs
WHERE event_message ILIKE '%trigger%' OR event_message ILIKE '%function%'
ORDER BY timestamp DESC LIMIT 50;

-- Verify triggers are registered
SELECT tgname, tgrelid::regclass, tgtype, tgenabled
FROM pg_trigger
WHERE tgisinternal = false
ORDER BY tgrelid::regclass, tgname;
```

---

## Future Extensibility Assessment

| Feature | Blocked? | Required Changes |
|---|---|---|
| Cross-society marketplace | Yes | Add `visibility` column to seller_profiles/products, rewrite SELECT RLS policies |
| Society feature gating (paid tiers) | No | Add `subscription_tier` to societies + `society_features` table |
| Builder-level analytics | No | `get_builder_dashboard()` already aggregates; extend as needed |
| Society federation | Partially | `builder_societies` serves as federation layer; UI needs context-switching |
| Audit log analytics | No | Query `audit_log` with society_id + action filters |
