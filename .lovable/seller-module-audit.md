# Seller Module — Feature & Rule Inventory

> Generated: 2026-02-22 | Source: Code analysis only (no assumptions)

## 1. Seller Onboarding (BecomeSellerPage)

### 1.1 Six-Step Wizard
- **Steps**: Category → Specialize → Store Details → Settings → Products → Review
- **Step 1 (Category)**: Select a `primary_group` from `parent_groups` table
  - Group conflict check: If user already has a non-draft seller profile for this group → shows existing seller info, blocks creation
  - Each user can have ONE seller profile per `primary_group`
- **Step 2 (Specialize)**: Select sub-categories within the chosen parent group
  - Categories filtered by `groupedConfigs[selectedGroup]`
- **Step 3 (Store Details)**: business_name (required), description (optional)
  - **Auto-save draft**: If group `requires_license`, a draft seller profile is auto-created after 800ms debounce once business_name is filled
  - Query-before-insert guard prevents duplicate drafts
  - License upload shown inline if group requires it
- **Step 4 (Settings)**: Fulfillment mode, delivery note, COD/UPI, operating days, store images
  - Fulfillment options: `self_pickup`, `delivery`, `both`
  - UPI ID required if `accepts_upi` is enabled
  - Operating days: at least 1 required at submission
  - Store images: profile (1:1 crop), cover (16:9 crop)
- **Step 5 (Products)**: Add products via `DraftProductManager`
  - At least 1 product required to submit
  - All products created as `draft` status
- **Step 6 (Review)**: Seller declaration checkbox required
  - Submits by updating `verification_status` from `draft` → `pending`
  - All draft products updated to `pending` simultaneously
  - `seller` role inserted for the user
  - Society validation called AFTER submission

### 1.2 Draft Resume
- On mount, checks for existing `verification_status = 'draft'` profile
- If found: restores all form fields (`select('*')`), loads existing products, jumps to Step 3
- If user has a non-draft profile for same group: shows existing seller, doesn't create new

### 1.3 Save Draft & Exit
- Available from Step 3+, calls `saveDraft()` and navigates to `/profile`

## 2. Seller Dashboard (SellerDashboardPage)

### 2.1 Active Seller Selection
- `activeSellerId = currentSellerId || sellerProfiles[0].id`
- Supports multi-seller context switching via `SellerSwitcher`

### 2.2 Store Status Card
- Shows business name, primary group, open/closed status
- Toggle availability switch → updates `is_available` on `seller_profiles`
- Audit log on toggle: `store_opened` / `store_closed`
- Pending status: Shows "Verification Pending" banner

### 2.3 Visibility Health Checklist (`useSellerHealth`)
- **Critical checks** (must pass for buyer visibility):
  - C1: Store approved (`verification_status = 'approved'`)
  - C2: Store open (`is_available = true`)
  - C3: At least 1 approved & available product
  - C4: Parent group active
  - C5: License approved (if mandatory for group)
- **Product checks**: Draft count, pending count, rejected count, missing images, disabled categories
- **Discovery checks**: Society coordinates exist, cross-society selling enabled
- **Quality checks**: Profile image, description (≥10 chars), operating hours, operating days
- Summary: `isFullyVisible` = all critical checks pass or info

### 2.4 Dashboard Stats (`useSellerOrderStats`)
- Single query fetches all orders for seller
- Client-side computation: total, pending, completed, today, earnings (today/week/total)
- `completed` and `delivered` statuses count toward earnings
- `preparing` and `ready` count toward pending
- Stale time: 10s

### 2.5 Quick Actions
- Links to Products, Settings, Earnings

### 2.6 Order List (Infinite scroll)
- Filters: all, today, pending, preparing, ready, completed
- Page size: 20, cursor-based pagination by `created_at`
- Per-item status tracking: each `order_item` has independent status

### 2.7 Analytics (`useSellerAnalytics`)
- Top 5 products by order quantity (excludes cancelled)
- Peak hours (top 5)
- Repeat customers (buyers with ≥2 non-cancelled orders)
- Cancellation rate

### 2.8 Coupon Manager
- Create: code (uppercased), type (percentage/flat), discount_value, min_order, max_discount, usage_limit, per_user_limit, expires_at
- Society-scoped: `society_id = profile.society_id`
- Unique constraint on code within society
- Toggle active/inactive
- Delete coupons
- **Guard**: Cannot create when `viewAsSocietyId` is set (admin viewing)

### 2.9 Earnings Summary
- Shows today/week/total earnings from `useSellerOrderStats`

## 3. Product Management (SellerProductsPage)

### 3.1 Add Product
- Required fields: name, category (within seller's primary group)
- Price validation: Required unless `action_type` is `contact_seller`, `request_quote`, or `make_offer`
- Contact phone required if `action_type = 'contact_seller'`, format: 7-15 chars of digits/+/-/spaces/parens
- Category-aware form: veg toggle and duration field shown/hidden based on `category_config`
- Image upload via `ProductImageUpload` (with AI generation option)
- Stock management: `stock_quantity`, `low_stock_threshold` (default 5)
- Subcategory support via `useSubcategories`
- **New products**: `approval_status = 'draft'`
- **Edited products**: `approval_status = 'pending'` (re-approval required)

### 3.2 Bulk Upload (`BulkProductUpload`)
- Two modes: Multi-row grid, CSV upload
- CSV requires: `name`, `price` columns
- Category-intelligent: veg toggle and duration columns shown/hidden per row's category
- Validation: name required, positive price, valid category slug, duplicate name+category check
- All bulk products saved as `draft`
- Client-side validation before save

### 3.3 Product Visibility Rules
- Products visible to buyers only when:
  - `approval_status = 'approved'` AND
  - Seller `verification_status = 'approved'` AND
  - (Same society OR seller `sell_beyond_community = true`)
- Sellers always see their own products regardless of status

### 3.4 License Blocking
- If seller's group has `requires_license = true` AND `license_mandatory = true`:
  - Checks for approved license
  - If not approved: shows license blocked warning
  - DB trigger `check_seller_license` prevents non-draft products without approved license

### 3.5 Product Delete
- Confirmation dialog required
- Direct delete from `products` table
- RLS: Owner (via seller_profiles.user_id) or admin

## 4. Seller Settings (SellerSettingsPage)

### 4.1 Store Pause/Resume
- Toggle `is_available` with audit logging
- Optimistic UI with rollback on failure

### 4.2 Store Images
- Cover: 16:9 aspect ratio, croppable
- Profile: 1:1 aspect ratio, croppable

### 4.3 Category Management
- Categories restricted to seller's `primary_group`
- Cross-group category selection blocked with toast error
- Primary group is read-only after creation ("Contact admin to change")

### 4.4 Operating Schedule
- Days of week checkboxes
- Availability start/end times (HH:MM)

### 4.5 Payment Settings
- COD toggle
- UPI toggle + UPI ID (required when enabled)
- Bank details: account number, IFSC, account holder

### 4.6 Cross-Society Selling
- `sell_beyond_community` toggle
- `delivery_radius_km` slider (1-10 km)
- DB trigger: `validate_delivery_radius()` enforces 1-10 range

### 4.7 Fulfillment Settings
- Mode: self_pickup, delivery, both
- Delivery note (free text)
- Minimum order amount
- DB trigger: `validate_fulfillment_mode()` enforces valid values

### 4.8 License Upload Section
- Shown if group `requires_license = true`
- License states: none, pending, approved, rejected
- Re-upload allowed on rejection (with admin notes shown)
- License number optional, editable after approval

### 4.9 Validation on Save
- Business name required
- At least 1 category required
- UPI ID required if UPI enabled

## 5. Seller Detail Page (Buyer View)

### 5.1 Access Control
- Non-approved sellers return "Seller not found"
- Cross-society: blocked if `sell_beyond_community = false` and different society
- Products filtered: `is_available = true` AND `approval_status = 'approved'`

### 5.2 Display
- Cover image, profile image, business name, description
- Rating stars, review count
- Location (society name), distance calculation (haversine)
- Operating hours, operating days
- Fulfillment mode badge, minimum order badge, delivery note
- Trust signals: completed orders, avg response time, 0% cancellation badge
- Category tags

### 5.3 Menu Search
- Client-side filter by product name and description
- Category filter tabs

### 5.4 Report Seller
- Types: spam, fraud, harassment, inappropriate, other
- Optional description
- Inserts into `reports` table with `reporter_id`

## 6. Seller Earnings (SellerEarningsPage)

### 6.1 Stats Calculation
- Fetches all `payment_records` for the seller
- "Paid" = `payment_status = 'paid'` OR (`pending` AND order `completed`)
- Time buckets: today, this week, this month, all time
- Pending payout: `payment_status = 'pending'`

### 6.2 Transaction History
- Shows order ID (first 8 chars), buyer name, amount, payment status, method, timestamp

## 7. Admin Seller Review (SellerApplicationReview)

### 7.1 Application List
- Filter: pending only or all
- Shows: business name, owner, society, status, group, pending licenses count, product count

### 7.2 Approval Flow
- **Approve**: Sets `verification_status = 'approved'`
  - Inserts `seller` role for user
  - **Cascades**: All pending/draft products → `approval_status = 'approved'`
  - Sends notification: "🎉 Congratulations! Your store is approved!"
- **Reject**: Sets `verification_status = 'rejected'`
  - Removes `seller` role
  - Optional rejection note

### 7.3 License Review
- Approve/reject individual licenses
- Admin notes field
- Sets `reviewed_at` timestamp

### 7.4 License Config
- Per-group toggle: `requires_license`
- Per-group toggle: `license_mandatory`
- Editable: `license_type_name`, `license_description`

### 7.5 Product Approval
- Per-product approve/reject (in expanded seller view)

## 8. RLS Policies

### seller_profiles
| Operation | Policy |
|-----------|--------|
| SELECT | Approved sellers visible to all; own profile; admin |
| INSERT | `user_id = auth.uid()` |
| UPDATE | Owner, admin, or society admin of same society |

### products
| Operation | Policy |
|-----------|--------|
| SELECT | Owner (via seller_profiles), admin, approved products from approved same-society sellers, approved products from cross-society sellers |
| INSERT | Owner (via seller_profiles) |
| UPDATE | Owner or admin |
| DELETE | Owner or admin |

### seller_licenses
| Operation | Policy |
|-----------|--------|
| SELECT | Owner (via seller_profiles) or admin |
| INSERT | Owner (via seller_profiles) |
| UPDATE | Owner or admin |

### coupons
| Operation | Policy |
|-----------|--------|
| ALL | Admin |
| ALL | Seller owner (via seller_profiles) |
| SELECT | Active coupons in user's society (not expired, started) |

## 9. Database Triggers & Constraints

- `validate_delivery_radius()`: 1-10 km
- `validate_fulfillment_mode()`: self_pickup, delivery, both
- `validate_product_category()`: Category must exist and be active, parent group must be active
- `validate_product_price_requirement()`: Price required when category demands it
- `validate_product_approval_status()`: draft, pending, approved, rejected
- `normalize_product_hints()`: Auto-sets `is_veg=true` when category doesn't show veg toggle; clears `prep_time_minutes` when category doesn't show duration
- `check_seller_license()`: Blocks non-draft products if mandatory license not approved
- `decrement_stock_on_order()`: Auto-decrements stock, auto-disables product at 0
- `trg_update_seller_stats_on_order()`: Recomputes completed_order_count, cancellation_rate, avg_response_minutes on status change
- `trg_seller_activity_timestamp()`: Updates `last_active_at` on product changes

## 10. Discovered Issues

### S1 — Product Edit Always Resets to 'pending' (INFO)
When editing ANY product field (even non-critical like description), `approval_status` is set to `pending`, requiring re-approval. This is by design for safety but could frustrate sellers editing descriptions or toggling availability.

### S2 — Earnings Page Uses payment_records, Dashboard Uses orders (MEDIUM)
The earnings page (`SellerEarningsPage`) fetches from `payment_records` table, while the dashboard stats (`useSellerOrderStats`) compute earnings from `orders.total_amount`. These could diverge if payment records aren't created for every completed order, leading to inconsistent earnings display between dashboard and earnings page.

### S3 — Coupon Society ID Uses profile.society_id Directly (LOW)
Coupon creation uses `profile.society_id` which is correct per the write-side rule. But the guard only disables the button when `viewAsSocietyId` is set — an admin switching context could still create coupons for wrong society if `viewAsSocietyId` is null but they manage multiple societies.

### S4 — Bulk Upload Missing Image Requirement (LOW)
Individual product creation has image upload, but bulk upload creates products without images. While products work without images, the health checklist warns about missing images. Consider adding a note in bulk upload about image requirements.

### S5 — No seller_profiles DELETE RLS Policy (INFO)
No direct delete policy exists for seller profiles, matching the auth pattern. Deletion only via admin or edge function.

### S6 — Admin Approval Cascades ALL Products to 'approved' (MEDIUM)
When admin approves a seller, ALL pending/draft products are auto-approved. This means products aren't individually reviewed during initial approval. If a seller has problematic products, they all go live simultaneously.

### S7 — Product SELECT Policy Cross-Society Gap (LOW)
Cross-society product visibility requires `sell_beyond_community = true` on the seller but doesn't check `delivery_radius_km` or society coordinates at the RLS level. The distance check happens only in the `search_nearby_sellers` RPC. Direct product queries bypass distance restrictions.
