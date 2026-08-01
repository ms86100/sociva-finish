# App Navigator — Full Feature & Rule Inventory

## Audit Date: 2026-02-22
## Scope: 60 pages, 6 roles, 14+ feature modules

---

## Module: Society Management

### Bulletin (/community)
- **Feature Gate**: `bulletin`
- **Tabs**: Board, Quick Help
- **Board Tab**: Posts filtered by `effectiveSocietyId`, `is_archived = false`; ordered by `is_pinned DESC, created_at DESC`; category filter; search via `ilike` on title/body; realtime subscription on `bulletin_posts` + `bulletin_comments`
- **Most Discussed**: Posts from last 24h with `comment_count > 0`, top 5, only shown when category = 'all'
- **Upvote**: Toggle via `bulletin_votes` insert/delete; optimistic UI with `userVotes` Set
- **Help Tab**: `help_requests` ordered by `created_at DESC`; responses via `help_responses`; only author can mark as fulfilled; only non-authors can respond when status = 'open'
- **Issue B1 (LOW)**: Help responses are visible to ALL users in the same society (comment at line 138 says "only visible to author + responder" but no RLS enforces this). Any society member can read all responses.

### Society Finances (/society/finances)
- **Feature Gate**: `finances`
- **Tabs**: Spending (pie chart + expense list), Monthly (income vs expense chart), Budget, Flags (admin/society-admin only)
- **Summary**: Totals computed client-side from all expenses/income
- **Expense Flagging**: Any resident can flag an expense with a reason; stored in `expense_flags` table
- **Admin Actions**: Add Income, Add Expense, Export CSV; only visible to `isAdmin || isSocietyAdmin`
- **Issue B2 (LOW)**: Expense category filter via pie chart click is client-side only — selecting a category then scrolling loses the selection context

### Construction Progress (/society/progress)
- **Feature Gate**: `construction_progress`
- **Precondition**: `effectiveSociety.is_under_construction` must be true, otherwise shows "Not Available"
- **Tabs**: Timeline, Documents, Q&A
- **Tower Selector**: Filters milestones by `tower_id`
- **Milestone Reactions**: `milestone_reactions` table with thumbsup/concern types
- **Access Control**: `canManageProgress = isAdmin || isSocietyAdmin || isBuilderMember`
- **Overall Progress**: Computed as average of tower `current_percentage` values, or max milestone percentage if no towers

### Snag Reports (/society/snags)
- **Feature Gate**: `snag_management`
- **Collective Escalations**: Active `collective_escalations` shown at top with destructive styling
- **Ticket List**: All snag tickets for the society, ordered by `created_at DESC`
- **Detail Sheet**: Opens on card click; refresh on update

### Disputes (/disputes)
- **Feature Gate**: `disputes`
- **View Modes**: "My Concerns" (submitted_by = user.id) vs "All Society" (society-scoped, admin/society-admin only)
- **Tabs**: Open (not resolved/closed) vs Resolved
- **Create**: Via `CreateDisputeSheet`; FAB button always visible
- **Detail**: Admin mode when viewMode = 'all' AND (isSocietyAdmin || isAdmin)

### Maintenance (/maintenance)
- **Feature Gate**: `maintenance`
- **Admin Actions**: Generate Monthly Dues (bulk insert for all approved residents), Export CSV, Apply Late Fees (RPC)
- **Resident View**: Only own dues (filtered by `resident_id = user.id`)
- **Payment**: Razorpay integration for online payment; Mark Paid for admins
- **Issue B3 (MEDIUM)**: `handleBulkGenerate` uses `profile.society_id` instead of `effectiveSocietyId` (line 99). If an admin is using "view as" another society, the dues will be generated for the admin's own society, not the viewed society. This is a data integrity bug.

### Society Notices (/society/notices)
- **Feature Gate**: `society_notices`
- **Who Can Post**: `isAdmin || isSocietyAdmin || isBuilderMember`
- **Categories**: general, maintenance, safety, event, rule_change, financial
- **Pinning**: Checkbox in create form; pinned notices sorted first
- **Ordering**: `is_pinned DESC, created_at DESC`

### Society Admin (/society/admin)
- **Access Gate**: `isSocietyAdmin || isAdmin` required, otherwise shows "Access Denied"
- **Tabs**: Overview (CommitteeDashboard), Users (pending), Sellers (pending), Disputes, More
- **User Approval**: Approve/reject with audit logging
- **Seller Approval**: Approve adds `seller` role to `user_roles`; reject/suspend removes it
- **Admin Management**: Search approved residents by name, appoint as admin or moderator; duplicate detection via constraint
- **Feature Toggles**: DB-driven via `platform_features`; locked/unavailable states for package-restricted features
- **Security**: SecurityModeSettings + SecurityStaffManager
- **Payment Milestones**: AdminPaymentMilestones component
- **Society Switcher**: Only for platform admins (`isAdmin`)

### Society Dashboard (/society)
- **Deep Search**: Searches across label, stat, section title, and keywords
- **Feature Gating**: Items filtered by `isFeatureEnabled(featureKey)`
- **Stats**: Async fetch of open snags, disputes, expenses, milestones, docs, Q&A, pending dues
- **Committee Response Time**: Average acknowledgment time across disputes and snags (last 90 days)
- **Admin Tools Section**: Only shown to `isSocietyAdmin`
- **Platform Section**: Only shown to `isAdmin`
- **Trust Badge**: SocietyTrustBadge component

---

## Module: Builder Portal

### Builder Dashboard (/builder)
- **Access Gate**: `isBuilderMember || isAdmin`
- **Data**: `get_builder_dashboard` RPC returning builder info + society details
- **Aggregate Stats**: Societies, Members, Pending Approvals, Open Issues
- **Builder Stats**: Total Revenue, SLA Breached, On Track (from `useBuilderStats`)
- **Society Click**: Sets `viewAsSociety` and navigates
- **Pending/Disputes badges**: Clickable, navigate to specific admin pages
- **Setup Wizard**: Per-society `BuilderSetupWizard`
- **Feature Plan**: `BuilderFeaturePlan` showing package details
- **Announcements**: `BuilderAnnouncementSheet` targeting specific societies

### Builder Analytics (/builder/analytics)
- Separate page for portfolio analytics

### Builder Inspections (/builder-inspections)
- Inspection management for builder

---

## Module: Workforce & Domestic Help

### Workforce Management (/workforce)
- **Feature Gate**: `workforce_management`
- **Access Control**: `canManage = isSocietyAdmin || isAdmin` for register/suspend/blacklist actions
- **Tabs**: Active, Suspended, Blacklisted, Categories (admin only)
- **Filter**: By worker type (dynamic from data)
- **Worker Registration**: `WorkerRegistrationSheet` with category selection
- **Status Actions**: Suspend/Blacklist with confirmation dialog; Reactivate without confirmation
- **Flat Assignments**: Loaded separately and filtered per worker
- **Worker Categories**: `WorkerCategoryManager` for admin tab

### My Workers (/my-workers)
- Resident's registered domestic help

### Worker Hire (/worker-hire)
- **Feature Gate**: `worker_marketplace`
- Simple wrapper: Shows `ResidentJobsList` + "Post Job" button → navigates to `/worker-hire/create`

### Worker Jobs (/worker/jobs)
- Available job requests for workers

### Worker My Jobs (/worker/my-jobs)
- Worker's accepted/completed jobs

### Worker Attendance (/worker-attendance)
- Admin attendance tracking

### Worker Leave (/worker-leave)
- Leave records management

### Worker Salary (/worker-salary)
- Salary records management

### Domestic Help (/domestic-help)
- **REDIRECT**: Navigates to `/workforce` (deprecated page)

---

## Module: Security & Access

### Visitors (/visitors)
- **Feature Gate**: `visitor_management`
- **Tabs**: Today, Upcoming, History
- **Add Visitor**: Name required; generates 6-digit OTP when `isPreapproved` (default true)
- **OTP Expiry**: 24 hours from creation
- **Recurring**: Day selection (Mon-Sun)
- **Actions**: Check In, Check Out, Cancel (resident-scoped via `resident_id = user.id`)
- **Copy OTP**: Clipboard API
- **Export**: CSV export of visitor log
- **Visitor Types**: From `get_visitor_types_for_society` RPC with fallback to hardcoded list

### Authorized Persons (/authorized-persons)
- Feature-gated under `visitor_management`

### Parking (/parking)
- **Feature Gate**: `vehicle_parking`
- **Tabs**: Slots, Violations
- **Admin Actions**: Add Slot (slot_number, type, vehicle, flat); Resolve/Dismiss violations
- **Resident Actions**: Report Violation (type: unauthorized, double_parking, blocking, other)
- **Duplicate Detection**: DB constraint on slot_number (error code 23505)

### Parcels (/parcels)
- **Feature Gate**: `parcel_management`
- **Admin/Guard View**: All society parcels; flat number lookup for logging
- **Resident View**: Only own parcels (`resident_id = user.id`)
- **Tabs**: Pending (received/notified), Collected
- **Collect**: Updates status + timestamp + collector name
- **Photo Upload**: Optional, admin-only

---

## Module: Marketplace & Shopping

### Home (/)
- **Onboarding**: Shows `OnboardingWalkthrough` for first-time approved users
- **Verification**: Shows `VerificationPendingScreen` if not approved
- **Seller Congrats**: One-time banner when seller first approved (localStorage flag)
- **Sections**: SocietyQuickLinks, MarketplaceSection, CommunityTeaser

### Search (/search)
- **Cross-Society**: `browse_beyond_community` toggle persisted to profile
- **Search Radius**: Slider persisted to profile (1-10 km)
- **Debounced Search**: 300ms debounce on query
- **Filter Persistence**: Saved to localStorage
- **Nearby Products**: Via `search_nearby_sellers` RPC
- **Abort Controller**: Cancels stale searches
- **Category Filter**: Chip-based horizontal scroll
- **Sort/Filter**: Rating, veg/non-veg, price range, preset filters

### Categories (/categories)
- Category browsing grid

### Cart (/cart)
- Cart management with checkout flow

### Favorites (/favorites)
- Favorite sellers (filtered by `profile.society_id` after O6 fix)

### Subscriptions (/subscriptions)
- User subscription management

### Directory (/directory)
- Trust directory with seller/skill listings

---

## Module: Delivery

### Society Deliveries (/society/deliveries)
- **Feature Gate**: `delivery_management`
- Simple wrapper for `DeliveryMonitoringTab`

### Delivery Partners (/delivery-partners)
- Admin management of delivery partners

---

## Module: Notifications

### Notification Settings (/notifications)
- **Client-side only**: Preferences stored in localStorage
- **Categories**: Orders, Chat, Promotions, Sounds
- **Defaults**: All true

### Notification Inbox (/notifications/inbox)
- Notification feed from `notification_queue`

---

## Module: Core Pages

### Landing (/welcome)
- Public landing page with carousel, category groups, trust badges
- Auto-plays slides every 8 seconds

### Auth (/auth)
- Email/password authentication

### Profile (/profile)
- User profile management

### Privacy Policy (/privacy-policy), Terms (/terms), Community Rules (/community-rules), Help (/help)
- Static/semi-static content pages

### Pricing (/pricing)
- Package pricing display

---

## Module: Platform Admin

### Admin Panel (/admin)
- **Access**: Platform admin only
- **Tabs**: Navigate, Products, Sellers, Disputes, Reviews, Payments, Reports, Settings, Categories, Features, Builders
- **App Navigator**: Lists all 45+ features for quick access
- **Product Approvals**: `AdminProductApprovals`
- **Category Manager**: `CategoryManager` + `SubcategoryManager`
- **Feature Management**: Platform-level feature flags
- **Platform Settings**: `PlatformSettingsManager`
- **Emergency Broadcast**: `EmergencyBroadcastSheet`

---

## Discovered Issues Summary

| ID | Severity | Module | Description | Status |
|----|----------|--------|-------------|--------|
| B1 | LOW | Bulletin | Help responses visible to all society members despite comment claiming otherwise | Documented |
| B2 | LOW | Finances | Expense category filter is client-side only, no persistent state | Documented |
| B3 | MEDIUM | Maintenance | `handleBulkGenerate` used `profile.society_id` instead of `effectiveSocietyId` | **FIXED** |
| B4 | MEDIUM | Delivery | `DeliveryPartnerManagementPage` wrote partners to `effectiveSocietyId` instead of `profile.society_id` | **FIXED** |
| B5 | LOW | Worker Leave | `WorkerLeavePage.handleAdd` wrote to `effectiveSocietyId` instead of `profile.society_id` | **FIXED** |
| B6 | LOW | Worker Salary | `WorkerSalaryPage.handleAdd` wrote to `effectiveSocietyId` instead of `profile.society_id` | **FIXED** |
| B7 | MEDIUM | Reports | `SocietyReportPage` has no feature gate — any authenticated user can view financial reports | Documented |

### Previously Fixed (Other Audits)
- G1-G7: Security & Gate fixes (see security-gate-audit.md)
- O1-O7: Orders & Payments fixes (see orders-payments-audit.md)
- Auth/Profiles and Seller module (see respective audit files)
