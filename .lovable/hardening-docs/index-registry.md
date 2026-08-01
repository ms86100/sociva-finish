# Index Registry — 51 Custom Indexes

> Verified against `pg_indexes` on 2026-02-14.

| # | Index Name | Table | Columns | Type |
|---|---|---|---|---|
| 1 | idx_audit_log_actor | audit_log | (actor_id, created_at DESC) | btree |
| 2 | idx_audit_log_society | audit_log | (society_id, created_at DESC) | btree |
| 3 | idx_audit_log_target | audit_log | (target_type, target_id) | btree |
| 4 | idx_bulletin_comments_post | bulletin_comments | (post_id) | btree |
| 5 | idx_bulletin_posts_category | bulletin_posts | (category) | btree |
| 6 | idx_bulletin_posts_created | bulletin_posts | (created_at DESC) | btree |
| 7 | idx_bulletin_posts_pinned | bulletin_posts | (is_pinned) WHERE is_pinned = true | partial btree |
| 8 | idx_bulletin_posts_society | bulletin_posts | (society_id) | btree |
| 9 | idx_bulletin_rsvps_post | bulletin_rsvps | (post_id) | btree |
| 10 | idx_bulletin_votes_post | bulletin_votes | (post_id) | btree |
| 11 | idx_construction_milestones_society | construction_milestones | (society_id, created_at DESC) | btree |
| 12 | idx_dispute_tickets_society_created | dispute_tickets | (society_id, created_at DESC) | btree |
| 13 | idx_dispute_tickets_society_status | dispute_tickets | (society_id, status) | btree |
| 14 | idx_favorites_seller_id | favorites | (seller_id) | btree |
| 15 | idx_favorites_user_id | favorites | (user_id) | btree |
| 16 | idx_help_requests_society | help_requests | (society_id) | btree |
| 17 | idx_help_requests_status | help_requests | (status) | btree |
| 18 | idx_help_responses_request | help_responses | (request_id) | btree |
| 19 | idx_maintenance_dues_society_month | maintenance_dues | (society_id, month DESC) | btree |
| 20 | idx_order_items_order_id | order_items | (order_id) | btree |
| 21 | idx_order_items_status | order_items | (status) | btree |
| 22 | idx_orders_buyer_id | orders | (buyer_id) | btree |
| 23 | idx_orders_buyer_status | orders | (buyer_id, status) | composite btree |
| 24 | idx_orders_created_at | orders | (created_at) | btree |
| 25 | idx_orders_seller_id | orders | (seller_id) | btree |
| 26 | idx_orders_seller_status | orders | (seller_id, status) | composite btree |
| 27 | idx_orders_society | orders | (society_id) | btree |
| 28 | idx_orders_status | orders | (status) | btree |
| 29 | idx_parent_groups_slug | parent_groups | (slug) | btree |
| 30 | idx_parent_groups_sort_order | parent_groups | (sort_order) | btree |
| 31 | idx_products_seller_id | products | (seller_id) | btree |
| 32 | idx_profiles_society_id | profiles | (society_id) | btree |
| 33 | idx_profiles_society_verification | profiles | (society_id, verification_status) | composite btree |
| 34 | idx_seller_profiles_primary_group | seller_profiles | (primary_group) | btree |
| 35 | idx_seller_profiles_society_id | seller_profiles | (society_id) | btree |
| 36 | idx_seller_profiles_society_verification | seller_profiles | (society_id, verification_status) | composite btree |
| 37 | idx_skill_endorsements_skill | skill_endorsements | (skill_id) | btree |
| 38 | idx_skill_listings_society | skill_listings | (society_id) | btree |
| 39 | idx_skill_listings_user | skill_listings | (user_id) | btree |
| 40 | idx_snag_tickets_society_status | snag_tickets | (society_id, status) | composite btree |
| 41 | idx_societies_pincode | societies | (pincode) | btree |
| 42 | idx_societies_slug | societies | (slug) | btree |
| 43 | idx_society_activity_society_created | society_activity | (society_id, created_at DESC) | composite btree |
| 44 | idx_society_expenses_society_created | society_expenses | (society_id, created_at DESC) | composite btree |
| 45 | idx_subscription_deliveries_sub | subscription_deliveries | (subscription_id) | btree |
| 46 | idx_subscriptions_buyer | subscriptions | (buyer_id) | btree |
| 47 | idx_subscriptions_next_delivery | subscriptions | (next_delivery_date) | btree |
| 48 | idx_subscriptions_seller | subscriptions | (seller_id) | btree |
| 49 | idx_subscriptions_status | subscriptions | (status) | btree |
| 50 | idx_user_notifications_user_read | user_notifications | (user_id, is_read) | composite btree |
| 51 | idx_user_roles_user_role | user_roles | (user_id, role) | composite btree |

## Coverage Assessment

| Critical Query Path | Indexes Supporting It | Status |
|---|---|---|
| Auth hydration (user_roles lookup) | idx_user_roles_user_role | ✅ |
| Society dashboard (orders by society) | idx_orders_society, idx_orders_buyer_status, idx_orders_seller_status | ✅ |
| Marketplace listing (seller by society) | idx_seller_profiles_society_id, idx_seller_profiles_society_verification | ✅ |
| Admin approval queue | idx_profiles_society_verification | ✅ |
| Dispute dashboard | idx_dispute_tickets_society_status, idx_dispute_tickets_society_created | ✅ |
| Snag management | idx_snag_tickets_society_status | ✅ |
| Financial reports | idx_society_expenses_society_created | ✅ |
| Notification inbox | idx_user_notifications_user_read | ✅ |
