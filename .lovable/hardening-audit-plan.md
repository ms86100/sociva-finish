# Deep Module Reality Audit — Full Hardening Plan

> **Goal**: Finalize and stabilize every module. No new features. Only fixes, cleanup, and hardening.
> **Method**: Phased implementation, 7-8 tasks per phase. User confirms before each phase begins.

---

## Phase 1 — Auth, Landing & Core Navigation
**Modules**: `/`, `/auth`, `/welcome`, `/privacy-policy`, `/terms`, `/pricing`, `/help`, `/community-rules`

| # | Task | Module | Type |
|---|------|--------|------|
| 1 | Audit LandingPage for dead links, placeholder CTAs, hardcoded text, missing SEO tags | `/` | UI/SEO |
| 2 | Audit AuthPage for incomplete flows (password reset, email verify UX, error handling, rate limiting) | `/auth` | Functional |
| 3 | Audit OnboardingWalkthrough and VerificationPendingScreen for dead UI and edge cases | `/welcome` | UI/Logic |
| 4 | Audit static pages (PrivacyPolicy, Terms, Pricing, Help, CommunityRules) for hardcoded content, broken links, missing back navigation | `/privacy-policy`, `/terms`, `/pricing`, `/help`, `/community-rules` | UI |
| 5 | Verify AuthContext role derivation: isSeller, isAdmin, isSocietyAdmin, isBuilderMember — ensure no privilege escalation via stale state | Auth system | Security |
| 6 | Audit Header, BottomNav, AppLayout for inconsistent nav states, dead routes, missing role gating | Layout | UI/Logic |
| 7 | Audit ErrorBoundary, OfflineBanner, NotFound for proper error/edge-case coverage | Error handling | UX |
| 8 | Verify all auth-gated routes redirect properly when unauthenticated; check for flash-of-content | Router | Security/UX |

---

## Phase 2 — Marketplace Discovery & Product Interaction
**Modules**: `/search`, `/category/:category`, `/seller/:id`, `/cart`, `/favorites`

| # | Task | Module | Type |
|---|------|--------|------|
| 1 | Audit SearchPage for race conditions (AbortController), empty state, hardcoded filters, missing loading | `/search` | Functional |
| 2 | Audit CategoryPage and CategoryGroupPage for hardcoded category lists vs DB-driven, dead filter chips | `/category/:category` | Logic |
| 3 | Audit SellerDetailPage — verify approval_status filtering, society scoping, dead community gating (already partially fixed) | `/seller/:id` | Security |
| 4 | Audit ProductCard, ProductDetailSheet, ProductGridCard for inconsistent action_type handling, missing contact_phone, price display for enquiry-only | Product components | UI/Logic |
| 5 | Audit CartPage — verify cart_item category validation trigger works, empty cart UX, coupon flow completeness | `/cart` | Functional |
| 6 | Audit FavoritesPage for proper seller status filtering (don't show suspended/rejected sellers) | `/favorites` | Logic |
| 7 | Audit FloatingCartBar, CouponInput, PaymentMethodSelector for dead UI, hardcoded values | Cart components | UI |
| 8 | Verify all product discovery queries enforce `approval_status = 'approved'` and `is_available = true` consistently | Cross-module | Security |

---

## Phase 3 — Seller Module (Dashboard, Products, Settings, Earnings, Onboarding)
**Modules**: `/seller`, `/seller/products`, `/seller/settings`, `/seller/earnings`, `/become-seller`

| # | Task | Module | Type |
|---|------|--------|------|
| 1 | Audit SellerDashboardPage — verify all stats are real-data-driven, no hardcoded thresholds, badge logic uses semantic tokens | `/seller` | Logic/UI |
| 2 | Audit SellerProductsPage — verify price validation is DB-driven, approval lifecycle is complete, bulk upload edge cases | `/seller/products` | Functional |
| 3 | Audit SellerSettingsPage — verify bank details handling, fulfillment mode validation, category change restrictions | `/seller/settings` | Security |
| 4 | Audit SellerEarningsPage — verify multi-seller support, payment record accuracy, empty states | `/seller/earnings` | Functional |
| 5 | Audit BecomeSellerPage — verify license upload integration, draft-to-pending product transition, primary_group enforcement | `/become-seller` | Functional |
| 6 | Audit SellerSwitcher, StoreStatusCard, EarningsSummary, DashboardStats, QuickActions for dead UI | Seller components | UI |
| 7 | Audit SellerOrderCard, OrderFilters, SellerAnalytics, SellerBadges for hardcoded logic and consistency | Seller components | Logic |
| 8 | Verify seller RLS policies: can a seller access another seller's data via direct API? Test product/order isolation | Backend | Security |

---

## Phase 4 — Orders, Payments & Disputes
**Modules**: `/orders`, `/orders/:id`, `/disputes`, `/subscriptions`

| # | Task | Module | Type |
|---|------|--------|------|
| 1 | Audit OrdersPage for filter completeness, pagination, empty states, status badge consistency | `/orders` | UI/Logic |
| 2 | Audit OrderDetailPage for status flow integrity (placed→accepted→preparing→ready→delivered→completed), cancellation handling | `/orders/:id` | Functional |
| 3 | Audit OrderChat for real-time subscription cleanup, message delivery confirmation, unread count | Order chat | Functional |
| 4 | Audit OrderCancellation, OrderRejectionDialog, OrderHelpSheet for incomplete flows, missing backend calls | Order components | Logic |
| 5 | Audit DisputesPage, CreateDisputeSheet, DisputeDetailSheet for SLA enforcement, status transitions, anonymous submission | `/disputes` | Functional |
| 6 | Audit PaymentMethodSelector, RazorpayCheckout, UpiPaymentSheet for dead payment flows, error handling | Payment | Functional |
| 7 | Audit MySubscriptionsPage for subscription lifecycle, renewal handling, cancellation | `/subscriptions` | Functional |
| 8 | Verify order creation RPC (create_multi_vendor_orders) handles edge cases: out-of-stock, seller unavailable, expired coupons | Backend | Security |

---

## Phase 5 — Society & Community Module
**Modules**: `/community`, `/society`, `/society/finances`, `/society/progress`, `/society/snags`, `/society/reports`, `/society/admin`

| # | Task | Module | Type |
|---|------|--------|------|
| 1 | Audit BulletinPage — post creation, comment/vote flows, poll functionality, RSVP, archive logic | `/community` | Functional |
| 2 | Audit SocietyDashboardPage — health metrics accuracy, activity feed completeness, trust score display | `/society` | Logic |
| 3 | Audit SocietyFinancesPage — expense creation, flagging, view tracking, chart accuracy | `/society/finances` | Functional |
| 4 | Audit SocietyProgressPage — milestone creation, tower selection, document vault, Q&A tab completeness | `/society/progress` | Functional |
| 5 | Audit SnagListPage — snag creation, status transitions, photo uploads, collective escalation | `/society/snags` | Functional |
| 6 | Audit SocietyReportPage — report generation, data accuracy, empty states | `/society/reports` | Logic |
| 7 | Audit SocietyAdminPage — admin management, feature overrides, society switcher, role enforcement | `/society/admin` | Security |
| 8 | Verify all society-scoped data uses effectiveSocietyId for reads and profile.society_id for writes | Cross-module | Security |

---

## Phase 6 — Security, Gate & Visitor Management
**Modules**: `/gate-entry`, `/guard-kiosk`, `/security/verify`, `/security/audit`, `/visitors`, `/parking`, `/parcels`

| # | Task | Module | Type |
|---|------|--------|------|
| 1 | Audit GateEntryPage — QR generation, token expiry, entry type handling | `/gate-entry` | Functional |
| 2 | Audit GuardKioskPage — entry verification flow, manual entry approval, confirmation polling | `/guard-kiosk` | Functional |
| 3 | Audit SecurityVerifyPage — token validation, replay attack prevention, expired token UX | `/security/verify` | Security |
| 4 | Audit SecurityAuditPage — tiered visibility (officer vs admin), metric accuracy, log completeness | `/security/audit` | Logic |
| 5 | Audit VisitorManagementPage — visitor pre-approval, entry logging, guest management | `/visitors` | Functional |
| 6 | Audit VehicleParkingPage — slot management, vehicle registration, availability tracking | `/parking` | Functional |
| 7 | Audit ParcelManagementPage — parcel logging, pickup confirmation, notification flow | `/parcels` | Functional |
| 8 | Verify security RLS: guard can only access own society, security_staff role enforcement, gate-token edge function | Backend | Security |

---

## Phase 7 — Workforce, Workers & Domestic Help
**Modules**: `/workforce`, `/domestic-help`, `/worker/jobs`, `/worker/my-jobs`, `/worker-hire`, `/worker-hire/create`

| # | Task | Module | Type |
|---|------|--------|------|
| 1 | Audit WorkforceManagementPage — worker registration, category management, gate validation | `/workforce` | Functional |
| 2 | Audit DomesticHelpPage — help entry management, attendance tracking, photo uploads | `/domestic-help` | Functional |
| 3 | Audit WorkerJobsPage — available job listing, filtering, status display | `/worker/jobs` | Functional |
| 4 | Audit WorkerMyJobsPage — accepted jobs, completion flow, rating submission | `/worker/my-jobs` | Functional |
| 5 | Audit WorkerHirePage and CreateJobRequestPage — job creation, urgency handling, category selection | `/worker-hire`, `/worker-hire/create` | Functional |
| 6 | Audit WorkerRegistrationSheet, WorkerGateValidation, LiveCameraCapture for completeness | Worker components | Logic |
| 7 | Audit worker RPCs (accept_worker_job, complete_worker_job, rate_worker_job, validate_worker_entry) for edge cases | Backend | Security |
| 8 | Verify worker RLS policies, flat assignment enforcement, shift/day validation | Backend | Security |

---

## Phase 8 — Builder, Admin, Notifications & Final Polish
**Modules**: `/builder`, `/builder/analytics`, `/admin`, `/notifications`, `/notifications/inbox`, `/profile`, `/maintenance`, `/payment-milestones`, `/inspection`, `/directory`

| # | Task | Module | Type |
|---|------|--------|------|
| 1 | Audit BuilderDashboardPage and BuilderAnalyticsPage — multi-society management, stats accuracy | `/builder`, `/builder/analytics` | Functional |
| 2 | Audit AdminPage — user management, product approvals, disputes, category management, feature toggles, license management | `/admin` | Functional/Security |
| 3 | Audit NotificationsPage and NotificationInboxPage — notification delivery, read/unread, empty states | `/notifications`, `/notifications/inbox` | Functional |
| 4 | Audit ProfilePage — edit flow, delete account, verification status display | `/profile` | Functional |
| 5 | Audit MaintenancePage, PaymentMilestonesPage, InspectionChecklistPage for completeness | `/maintenance`, `/payment-milestones`, `/inspection` | Functional |
| 6 | Audit TrustDirectoryPage — trust score display, skill listings, endorsement flow | `/directory` | Functional |
| 7 | Final cross-module consistency pass: button labels, empty states, error messages, loading states, toast patterns | All modules | UX |
| 8 | Final security pass: verify no frontend-only validation, RLS coverage on all tables, trigger completeness | All modules | Security |

---

## Execution Rules

1. Each phase is implemented only after user confirms with "yes"
2. Every fix must reference actual implementation evidence
3. No new features — only fixes, cleanup, and hardening
4. Each task should result in concrete code changes or documented "no issue found"
5. After each phase: summary of changes + ask for confirmation to proceed

---

## Status Tracker

| Phase | Status | Tasks Done |
|-------|--------|------------|
| Phase 1 — Auth & Core | ✅ Done | 8/8 |
| Phase 2 — Discovery & Products | ✅ Done | 8/8 |
| Phase 3 — Seller Module | ✅ Done | 8/8 |
| Phase 4 — Orders & Payments | ✅ Done | 8/8 |
| Phase 5 — Society & Community | ✅ Done | 8/8 |
| Phase 6 — Security & Gate | ✅ Done | 8/8 |
| Phase 7 — Workforce & Workers | ✅ Done | 8/8 |
| Phase 8 — Admin & Final Polish | ✅ Done | 8/8 |
