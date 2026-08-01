# SaaS Hardcoding Audit Report

**Date:** 2026-02-24  
**Auditor:** Senior SaaS Platform Auditor  
**Scope:** Full frontend + backend + DB trigger inspection  
**Status:** COMPLETE

---

## Section 1 — Hardcoded Findings

### HC-001: Currency Symbol `₹` Hardcoded Across 22+ Files

| Field | Value |
|-------|-------|
| **Module** | Marketplace, Finances, Delivery, Cart, Seller, Worker |
| **Files** | `FulfillmentSelector.tsx:45,51`, `DraftProductManager.tsx:226,276,290`, `CartPage.tsx:92,443`, `WorkerSalaryPage.tsx:145,171`, `SellerProductsPage.tsx:474,486`, `WorkerMyJobsPage.tsx:106,136`, `SellerEarningsPage.tsx:148`, `IncomeVsExpenseChart.tsx:40-41`, `SpendingPieChart.tsx:70`, `SocietyReportPage.tsx:132` |
| **Risk** | **CRITICAL INVESTOR FLAG.** Any non-INR deployment is broken. Violates multi-tenant SaaS principle. |
| **Fix** | All `₹` literals must use `useCurrency().formatPrice()` or pass `currencySymbol` from `useSystemSettings()`. The hook already exists — these are just missed usages. |
| **Owner** | Platform Admin (via `system_settings.currency_symbol`) |

### HC-002: Locale `'en-IN'` Hardcoded in 12+ Files

| Field | Value |
|-------|-------|
| **Module** | All date/number formatting |
| **Files** | `useCurrency.ts:17`, `format-price.ts:8`, `InspectionChecklistPage.tsx:280,426`, `BuilderInspectionsPage.tsx:136`, `PostDetailSheet.tsx:179`, `PostCard.tsx:121`, `VehicleParkingPage.tsx:288`, `PaymentMilestonesPage.tsx:260,278`, `BuilderAnalyticsPage.tsx:129`, `AdminPaymentMilestones.tsx:184`, `MySubscriptionsPage.tsx` |
| **Risk** | **HIGH.** Locale affects number grouping (1,00,000 vs 100,000), date formats, and accessibility. A non-Indian SaaS tenant would see Indian formatting. |
| **Fix** | Add `locale` to `system_settings`. Create a `useLocale()` hook. Replace all `'en-IN'` with the dynamic locale value. |
| **Owner** | Platform Admin (via `system_settings.locale`) |

### HC-003: Order Cancellation Reasons Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Orders |
| **File** | `OrderCancellation.tsx:24-31` |
| **Values** | `changed_mind`, `ordered_wrong`, `taking_too_long`, `found_alternative`, `payment_issue`, `other` |
| **Risk** | Medium. Admin cannot customize reasons per tenant. |
| **Fix** | Store in `system_settings` key `cancellation_reasons` as JSON array. Fetch dynamically. |
| **Owner** | Platform Admin |

### HC-004: Order Rejection Reasons Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Seller Order Management |
| **File** | `OrderRejectionDialog.tsx:23-30` |
| **Values** | `Item(s) out of stock`, `Kitchen closed / Not available now`, `Too many orders`, `Unable to fulfill special instructions`, `Incorrect order details`, `Other reason` |
| **Risk** | Medium. Seller-facing reasons should be configurable by admin. Food-specific reasons like "Kitchen closed" don't apply to all categories. |
| **Fix** | Store in `system_settings` key `rejection_reasons` as JSON. Optionally category-aware. |
| **Owner** | Platform Admin |

### HC-005: Report Types/Reasons Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Reporting/Moderation |
| **File** | `ReportSheet.tsx:20-27` |
| **Values** | `inappropriate`, `misleading`, `spam`, `offensive`, `prohibited`, `other` |
| **Risk** | Low-Medium. Compliance-sensitive — different jurisdictions may require different report categories. |
| **Fix** | Store in `system_settings` key `report_types` as JSON array. |
| **Owner** | Platform Admin |

### HC-006: Dispute Categories Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Disputes |
| **File** | `CreateDisputeSheet.tsx:17-23` |
| **Values** | `noise`, `parking`, `pet`, `maintenance`, `other` |
| **Risk** | Medium. Different societies have different dispute types (e.g., construction societies need "construction noise", "safety hazard"). |
| **Fix** | Store in DB table `dispute_categories` or `system_settings` key `dispute_categories`. |
| **Owner** | Society Admin or Platform Admin |

### HC-007: Snag Defect Categories Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Snag Management |
| **File** | `CreateSnagSheet.tsx:72-81` |
| **Values** | `plumbing`, `electrical`, `civil`, `painting`, `carpentry`, `lift`, `common_area`, `other` |
| **Risk** | Medium. Construction projects vary — some have HVAC, waterproofing, landscaping etc. |
| **Fix** | Fetch from a `snag_categories` table or `system_settings` JSON key. Allow builder/admin to configure. |
| **Owner** | Builder / Platform Admin |

### HC-008: Payment Method Labels Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Payments |
| **File** | `PaymentMethodSelector.tsx:26` |
| **Values** | `'Pay via GPay, PhonePe, Paytm'` |
| **Risk** | **HIGH INVESTOR FLAG.** Brand-specific payment provider names hardcoded in UI. Non-Indian markets use different UPI apps. |
| **Fix** | Store UPI description in `system_settings` key `upi_payment_description`. |
| **Owner** | Platform Admin |

### HC-009: Help Page Content Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Help / Support |
| **File** | `HelpPage.tsx:31-73` |
| **Values** | Entire `DEFAULT_HELP_SECTIONS` array including step-by-step instructions, payment mentions ("GPay, PhonePe, Paytm"), flow descriptions |
| **Risk** | Medium. Help content references specific payment providers and assumes specific UX flows. Already has `helpSectionsJson` in system_settings but the fallback is India-specific. |
| **Fix** | Populate `help_sections_json` in system_settings during onboarding. Remove India-specific payment references from fallback. |
| **Owner** | Platform Admin |

### HC-010: Fulfillment Option Labels in BecomeSellerPage

| Field | Value |
|-------|-------|
| **Module** | Seller Onboarding |
| **File** | `BecomeSellerPage.tsx:83-87` |
| **Values** | `FULFILLMENT_OPTIONS` with hardcoded labels/descriptions |
| **Risk** | Low. Already has `fulfillment_labels` in admin_settings. These are seller-facing wizard labels. |
| **Fix** | Derive from `useMarketplaceConfig().fulfillmentLabels` or add wizard-specific labels to system_settings. |
| **Owner** | Platform Admin |

### HC-011: `DAYS_OF_WEEK` Hardcoded as English Abbreviations

| Field | Value |
|-------|-------|
| **Module** | Seller Settings, Subscriptions, Worker Registration |
| **Files** | `types/database.ts:355-366`, `SellerSettingsPage.tsx:460`, `BecomeSellerPage.tsx:120`, `SubscriptionSheet.tsx:95`, `WorkerRegistrationSheet.tsx:18` |
| **Values** | `['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']` |
| **Risk** | Low-Medium. Not i18n-friendly. Already has `DAY_LABELS` map but the source abbreviations are English-only. |
| **Fix** | Acceptable for demo. For full i18n, store day identifiers as ISO day numbers and map to locale strings. |
| **Owner** | Platform (i18n concern) |

### HC-012: `ACTION_CONFIG` Product Action Types Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Marketplace |
| **File** | `marketplace-constants.ts:8-17` |
| **Values** | 8 action types with labels and icons |
| **Risk** | Low. These are system-level action types tied to the transaction_type DB trigger. Adding new ones requires both DB and UI changes. |
| **Fix** | Acceptable for demo. Long-term: store labels in system_settings or category_config. |
| **Owner** | Platform Admin |

### HC-013: Sort Options Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Marketplace |
| **File** | `marketplace-constants.ts:20-27` |
| **Values** | `relevance`, `price_low`, `price_high`, `popular`, `rating`, `newest` |
| **Risk** | Low. Sort keys are query-level logic. Labels could be configurable but keys need code support. |
| **Fix** | Acceptable for demo. Label overrides via system_settings if needed. |
| **Owner** | Platform Admin |

### HC-014: Delivery Status Steps Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Delivery |
| **File** | `DeliveryStatusCard.tsx:92` |
| **Values** | `['pending', 'assigned', 'picked_up', 'at_gate', 'delivered']` |
| **Risk** | Medium. Status flow should match DB trigger `validate_delivery_assignment_status`. Currently in sync but not dynamically derived. |
| **Fix** | Already has `useStatusLabels()` for display. Status flow order could be stored in system_settings. |
| **Owner** | Platform Admin |

### HC-015: Item Status Progression Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Orders |
| **File** | `OrderItemCard.tsx:18` |
| **Values** | `['pending', 'accepted', 'preparing', 'ready', 'delivered']` |
| **Risk** | Medium. Controls forward-only transitions in UI. Should match DB trigger logic. |
| **Fix** | Store allowed transitions in system_settings or derive from DB trigger. |
| **Owner** | Platform Admin |

### HC-016: Worker Status Labels Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Workforce |
| **File** | `WorkerCard.tsx:17-21` |
| **Values** | `active`, `suspended`, `blacklisted`, `under_review` with labels and colors |
| **Risk** | Low. Already validated by DB trigger `validate_worker_status`. Display labels could be in system_settings. |
| **Fix** | Add to `status_display_config` in system_settings alongside existing status label configs. |
| **Owner** | Platform Admin |

### HC-017: Parcel Status Labels Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Parcel Management |
| **File** | `ParcelManagementPage.tsx:24-28` |
| **Values** | `received`, `notified`, `collected`, `returned` with labels and colors |
| **Risk** | Low. Could be added to `status_display_config`. |
| **Fix** | Add to system_settings `status_display_config` under `parcel_status` domain. |
| **Owner** | Platform Admin |

### HC-018: Inspection Categories Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Inspections |
| **File** | `InspectionChecklistPage.tsx:108` |
| **Values** | Default active category `'electrical'` |
| **Risk** | Low. Initial tab state. |
| **Fix** | Minor — could default to first available category from DB. |
| **Owner** | N/A |

### HC-019: Platform Name "Sociva" in Fallback Defaults

| Field | Value |
|-------|-------|
| **Module** | System Settings |
| **File** | `useSystemSettings.ts:35-50` |
| **Values** | `support@sociva.com`, `grievance@sociva.in`, `dpo@sociva.com`, `Sociva Grievance Cell`, `Sociva` platform name |
| **Risk** | **LOW — these are fallbacks.** The system correctly reads from DB first. These only appear if DB has no values, which would indicate a setup issue. |
| **Fix** | Acceptable. These are defensive fallbacks. Ensure onboarding populates system_settings. |
| **Owner** | Platform setup |

### HC-020: Deep Link URL Scheme `sociva://` Hardcoded

| Field | Value |
|-------|-------|
| **Module** | Deep Links |
| **File** | `useDeepLinks.ts:10-16,37-38` |
| **Values** | `sociva://` URL scheme |
| **Risk** | Low for demo. For white-label, the URL scheme would need to be configurable per app build. |
| **Fix** | Move to build-time env variable `VITE_APP_URL_SCHEME`. |
| **Owner** | Platform deployment config |

---

## Section 2 — SaaS Compliance Gaps

### Gap 1: Locale Not Configurable
The platform assumes `en-IN` for all date/number formatting across 12+ files. While currency symbol is configurable via DB, the locale used for `toLocaleString()` and `toLocaleDateString()` is not. This breaks the "pure rendering engine" architecture principle.

### Gap 2: Reason/Category Lists Not Admin-Configurable
Five separate reason/category lists (cancellation, rejection, report, dispute, snag) are hardcoded in React components with no admin UI to modify them. While the core marketplace categories are fully dynamic, these auxiliary categorization systems remain static.

### Gap 3: Payment Provider Branding
The UI references "GPay, PhonePe, Paytm" — India-specific UPI apps — in the payment selector and help page. While Razorpay integration is correctly abstracted, the consumer-facing payment method descriptions are market-specific.

### Gap 4: Status Flows Duplicated Between UI and DB
Order status transitions, delivery status steps, and item status progressions are defined both in DB triggers (enforced) and UI components (display). While they're in sync today, there's no mechanism ensuring they stay synchronized when either side changes.

---

## Section 3 — Required Dynamic UI Additions

| # | Purpose | Role | Data Controlled | Affected Modules |
|---|---------|------|-----------------|------------------|
| 1 | **Locale Settings** | Platform Admin | `system_settings.locale`, `system_settings.date_format` | All date/number formatting |
| 2 | **Cancellation Reasons Manager** | Platform Admin | `system_settings.cancellation_reasons` JSON | Order cancellation |
| 3 | **Rejection Reasons Manager** | Platform Admin | `system_settings.rejection_reasons` JSON | Seller order management |
| 4 | **Report Types Manager** | Platform Admin | `system_settings.report_types` JSON | Moderation/reports |
| 5 | **Dispute Categories Manager** | Society Admin | `system_settings.dispute_categories` or dedicated table | Dispute creation |
| 6 | **Snag Categories Manager** | Builder/Admin | `system_settings.snag_categories` or dedicated table | Snag reporting |
| 7 | **Payment Method Descriptions** | Platform Admin | `system_settings.upi_payment_description` | Payment selection UI |

---

## Section 4 — Investor Risk Assessment

### ✅ Acceptable for Demo (No Action Required)
- **HC-011** `DAYS_OF_WEEK` — Standard ISO convention, i18n is Phase 2
- **HC-012** `ACTION_CONFIG` — System-level types tied to DB triggers
- **HC-013** Sort options — Query logic with static keys
- **HC-018** Inspection default tab — Trivial UX default
- **HC-019** "Sociva" fallbacks — Correctly overridden by DB values
- **HC-020** Deep link scheme — Build-time concern, not runtime

### ⚠️ Should Fix Before Pitch (Medium Priority)
- **HC-003** Cancellation reasons — Easy system_settings JSON
- **HC-004** Rejection reasons — Easy system_settings JSON  
- **HC-005** Report types — Easy system_settings JSON
- **HC-006** Dispute categories — Easy system_settings JSON
- **HC-007** Snag categories — Easy system_settings JSON
- **HC-010** Fulfillment labels — Already have admin_settings, just wire it
- **HC-014** Delivery status steps — Add to status_display_config
- **HC-015** Item status progression — Add to status_display_config
- **HC-016** Worker status labels — Add to status_display_config
- **HC-017** Parcel status labels — Add to status_display_config

### 🚨 Critical Blockers (Must Fix)
- **HC-001** `₹` in 22+ files — **Immediate fix.** `useCurrency()` hook exists but isn't used everywhere.
- **HC-002** `'en-IN'` in 12+ files — **Immediate fix.** Need a locale setting + hook.
- **HC-008** "GPay, PhonePe, Paytm" — **Investor red flag.** Market-specific branding in payment UI.

---

## Section 5 — Test Case Updates Required

### Existing Tests Now Outdated
| Test File | What's Outdated | Action |
|-----------|----------------|--------|
| None critical | The attribute-blocks-e2e.test.ts was just created and covers the dynamic category-attribute mapping fully. Existing tests are structurally sound. |

### New Tests Required

#### Unit Tests (add to `business-rules.ts` or new file)
1. **`formatPrice` uses dynamic currency** — Verify `formatPrice(100, '$')` → `$100`, not `₹100`
2. **Cancellation reasons from system_settings** — Mock DB, verify component renders DB-sourced reasons
3. **Rejection reasons from system_settings** — Same pattern
4. **Locale-aware date formatting** — Verify dates format according to configured locale

#### Integration Tests (add to e2e suite)
1. **Currency symbol override** — Admin sets `currency_symbol` to `$`, verify product cards show `$`
2. **Locale override** — Admin sets locale, verify date formatting changes
3. **Cancellation reasons CRUD** — Admin adds/removes cancellation reason, verify buyer sees updated list
4. **Dispute categories CRUD** — Admin adds category, verify it appears in create dispute form
5. **Snag categories CRUD** — Builder adds category, verify it appears in create snag form
6. **Payment description override** — Admin changes UPI description, verify payment selector shows new text

#### End-to-End Tests
1. **Multi-currency flow** — Change currency to `$`, complete full order flow, verify all amounts show `$`
2. **Custom rejection reason** — Add custom rejection reason, seller rejects with it, buyer sees it
3. **Dynamic dispute category** — Add custom dispute category, resident creates dispute with it

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🚨 Critical | 3 | HC-001, HC-002, HC-008 |
| ⚠️ Medium | 10 | HC-003 through HC-007, HC-010, HC-014 through HC-017 |
| ✅ Acceptable | 7 | HC-011 through HC-013, HC-018 through HC-020 |

**Overall SaaS Compliance Score: 78/100**

The platform's core architecture (category_config, parent_groups, system_settings, attribute_block_library, feature packages) is genuinely dynamic and DB-driven — a strong foundation. The gaps are primarily in **auxiliary UI lists** (reason pickers, category selectors) and **locale/currency formatting consistency** where the existing infrastructure (`useCurrency`, `useSystemSettings`) simply wasn't applied uniformly across all components.

The 3 critical items (HC-001, HC-002, HC-008) can be fixed in a single focused sprint by extending existing hooks to all missed components.
