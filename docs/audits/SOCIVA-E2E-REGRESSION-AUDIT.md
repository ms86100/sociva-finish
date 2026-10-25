# Sociva E2E regression audit

Date: 2026-10-25 (IST); remediations retested 2026-10-26 (IST)
Git: `54a3930` on `main` (working tree dirty with this audit's UI, search, cart, and seller-board fixes)
App under test: `http://localhost:3000` (Vite, HashRouter)
Supabase: production `kkzkuyhgdvyecmxtmkpy`
Payment: live credentials not used. No sandbox checkout executed.
Mobile: no iOS simulator, no Android emulator, no physical device this run.
Codemagic iOS: not triggered. Release gates are not met.

Verdict: **NO-GO for App Store / Play release.** Buyer discovery, search overlay, cart persistence across seller routes, Action needed schedule filters, labels, closed-store schedule UI, seller dashboard, and targeted Vitest suites are in good shape after the fix pass. Paid instant / scheduled / pre-order completion, native push sound, and device notification matrices were not executed. Those remain release blockers.

Do not treat this document as 100% coverage. Unexecuted cases are marked NOT TESTED or BLOCKED.

---

## 1. Environment and build

| Item | Value |
| --- | --- |
| Branch / SHA | `main` / `54a3930` |
| Local app | `http://localhost:3000/#/` |
| Buyer society | Shriram Greenfield Phase-2, Tower H |
| Logged-in buyer | session already present (Sagar Sharma). Also has seller + admin links |
| Test store | Biryani and Kebab `95d88378-b998-4f9b-b3f6-ff788aa2b81f` |
| `npx tsc --noEmit` | PASS (0 errors) |
| `npx vitest run` initial | 4 failed, 2585 passed, 326 skipped |
| `npx vitest run` final | 0 failed, 2590 passed, 326 skipped, 7 files skipped |
| `vite build` / iOS / Android native | NOT TESTED this run |
| Playwright `test:e2e` | NOT TESTED this run |
| Lint | NOT TESTED this run |

Skipped Vitest files are integration suites that could not seed users (`A user with this email address has already been registered`). Those 326 tests are skipped, not passed.

---

## 2. Authorised test store: Biryani and Kebab

Inspected only. **No settings were changed.** Nothing to restore.

Original snapshot (unchanged):

| Field | Value |
| --- | --- |
| `id` | `95d88378-b998-4f9b-b3f6-ff788aa2b81f` |
| `business_name` | Biryani and Kebab |
| `vacation_mode` | `true` |
| `is_available` | `false` |
| `availability_start` | `09:00:00` |
| `availability_end` | `06:00:00` |
| `operating_days` | Mon-Sun |
| Products | Biryani ₹99 `add_to_cart`; Kebab ₹99 `add_to_cart` |
| `accepts_preorders` | `false` on both products |

The store was left on vacation so real customers were not shown a false open window. Seller dashboard was opened as the store owner (read-only). Products, prices, stock, and hours were not edited.

Historical seller UI on this store already distinguishes Instant vs Scheduled (Apple Review scheduled slot Thu 22 Oct 9:45 am; Priya Reddy instant rows). Full paid lifecycle was not re-run.

---

## 3. How instant, scheduled, and pre-order actually differ

Derived from `src/lib/store-schedule.ts`, `src/hooks/useCartPage.ts`, `src/pages/OrdersPage.tsx`, and live UI:

| Mode | Trigger | Buyer UI | Seller UI | Stock / pay | This run |
| --- | --- | --- | --- | --- | --- |
| Instant | Store open, cart action, no future slot | ADD | Instant | Deduct on confirmed order (code) | NOT TESTED end to end. Historical Instant rows exist on Biryani and Kebab. |
| Scheduled | Store closed or buyer picks a future slot; `canScheduleWhileClosed` | Schedule CTA, slot on cart, Place Order stays disabled until min order and slot | Scheduled + slot time | Must not be treated as due now | Cart + seller list PASS. Paid place BLOCKED. |
| Pre-order | `products.accepts_preorders = true` plus lead/cutoff | Separate preorder banner and seller-when chip | Distinct from scheduled | Server ignores client `_preorder_seller_ids` as a bypass | No nearby product with the flag. Full E2E NOT TESTED. |

Scheduled does **not** mean "no seller notification". Intended policy in prior notification work is to queue the seller at placement, including closed hours. Device delivery of that policy is NOT TESTED here.

---

## 4. Feature coverage matrix

Result key: PASS, FAIL, BLOCKED, NOT TESTED.

### Buyer discovery and navigation

| ID | Case | Result | Evidence |
| --- | --- | --- | --- |
| B01 | Home loads society, hubs, listings | PASS | Home at `/#/` with Shriram Greenfield Phase-2, Tower H |
| B02 | Hub titles Discover services near you / Discover listings | PASS | Live headings |
| B03 | Typewriter placeholder when search is not focused | PASS | Rotating `Search "Pickles"`, `Search "Yoga"`, etc. |
| B04 | Search with spaces returns matching listings | PASS | `dragon veg momos` -> 2 matching products |
| B05 | Search hides idle home chrome and filters the grid | PASS | `2 matching products` + `Results for dragon veg momos` |
| B06 | Empty search results | PASS on Book | `yoga` -> `0 matching listings` / `No listings match this search` |
| B07 | Listing click while suggestions overlay is open | PASS (retest) | Listbox `pointer-events: none`; options stay clickable. First Schedule on Dragon Veg Momos went busy under open suggestions (2026-10-26) |
| B08 | Closed + schedulable: sharp photo, Opens at chip, Schedule CTA | PASS (UI copy) | Many cards: `Opens at 10:00 AM` + Schedule, or `Closed today` + Schedule. Blur removed in code when `canScheduleClosed` |
| B09 | Snacks chip avoids Madhubani makhana | PASS (contract) | `chip-listing-photo.ts` deprioritizes makhana; `discovery-intents.test.ts` fries/pakoda ranking. Visual chip photo not screenshot-verified |
| B10 | Guest browse | NOT TESTED | Session already logged in |
| B11 | Sign-up / login / logout | NOT TESTED | Would drop the live session |
| B12 | WhatsApp share iOS/Android | NOT TESTED | No native device |
| B13 | Deep links / app links | NOT TESTED | Hash navigate to `/seller/:id` from the automation client often stayed on home; in-app `View Store` worked |

### Cart

| ID | Case | Result | Evidence |
| --- | --- | --- | --- |
| C01 | Add scheduled item | PASS | Dragon Veg Momos ₹129, header Cart 1 item |
| C02 | Cart line, seller, qty, schedule slot | PASS | Mountain High Studio Cafe; Scheduled Tuesday Oct 27 10:45 AM; closed-store copy |
| C03 | Min-order gate | PASS | Minimum ₹299, Add ₹170 more, Place Order disabled |
| C04 | COD / pickup / delivery radios render | PASS | COD selected, Pickup FREE, Delivery FREE |
| C05 | Coupon empty apply disabled | PASS | Apply disabled until code entered |
| C06 | Server vs UI total | NOT TESTED | UI total ₹139 vs line ₹129. Bill breakdown not expanded. No server charge |
| C07 | Paid checkout | BLOCKED | Policy: no live paid order. Place Order was already disabled |
| C08 | Cart after seller dashboard visit | PASS (retest) | Biryani ₹99 in cart; Profile -> Seller Dashboard -> `/#/cart` still showed Biryani 1 item / ₹99. No paid place |

### Instant / scheduled / pre-order lifecycle

| ID | Case | Result | Evidence |
| --- | --- | --- | --- |
| O01 | Instant available only when store open | PASS (UI) | Closed cafes show Schedule not ADD after hours stamp fix |
| O02 | Instant paid place -> seller accept -> terminal | BLOCKED | Would create a real order |
| O03 | Scheduled add + persist slot | PASS | Cart showed Oct 27 10:45 AM |
| O04 | Scheduled paid place + seller notify | BLOCKED | No live place |
| O05 | Pre-order product + slot | NOT TESTED | Biryani/Kebab `accepts_preorders=false`. No other preorder listing exercised |
| O06 | Seller Instant vs Scheduled labels | PASS | Seller board: Instant Delivery vs Scheduled Delivery Pending |
| O07 | Overdue scheduled still Action needed | PASS (retest) | KPI + filter chips `0 Action needed` / `Upcoming ( 0 )`. Apple Review Oct 22 still visible under All, not Action needed |

### Book / Contact

| ID | Case | Result | Evidence |
| --- | --- | --- | --- |
| K01 | Book chrome Book and Enquire | PASS | `/#/book` |
| K02 | Idle header Popular services | PASS | Not "Popular bookable" |
| K03 | Book search hides tiles / banner | PASS | Tiles gone; matching-count header |
| K04 | Contact chrome Contact Seller | PASS | `/#/services` |
| K05 | Contact idle header Browse listings | PASS | Not "NEARBY SELLERS" |
| K06 | Contact grouped seller listings | PASS | Logo Cab Services, tuition, sarees, salon |
| K07 | Book a slot / pay | NOT TESTED | No booking confirmation submitted |
| K08 | Enquiry submit / credits debit | NOT TESTED | No message sent |
| K09 | Contact Seller CTA | NOT TESTED | Listings rendered; WhatsApp/chat not opened |

### Payments, inventory, notifications

| ID | Case | Result | Evidence |
| --- | --- | --- | --- |
| P01 | Razorpay success/fail/cancel | BLOCKED | No sandbox run; live charges forbidden |
| P02 | Webhook duplicate / retry | NOT TESTED | |
| P03 | COD place | BLOCKED | Would create a real COD order |
| P04 | Stock decrement | NOT TESTED | No confirmed order this run |
| P05 | PNQ last 24h | PASS (server accept) | 190 `processed`, 0 failed in 24h |
| P06 | Dead letter | Observed | 3 rows, last 2026-10-14, `No device token for seller order alert` |
| P07 | Android/iOS foreground/background/killed push | NOT TESTED | No device |
| P08 | Push sound / channel / APNs | NOT TESTED | |

### Seller / admin / backend

| ID | Case | Result | Evidence |
| --- | --- | --- | --- |
| S01 | Seller dashboard loads Biryani and Kebab | PASS | `/#/seller` |
| S02 | Orders / Help / Refunds / Plan / Store / Stats tabs | PASS | Tabs present; Orders and Stats opened |
| S03 | Stats sections (Fulfillment, On-Time, Response, Retention, Rating) | PASS | Values rendered; border styling not pixel-verified |
| S04 | Credits widget | PASS | Available ₹200, reserved ₹20, used this month ₹10 |
| S05 | Enable/disable store, hours edit | NOT TESTED | Left vacation as-is |
| S06 | Product CRUD | NOT TESTED | Would overwrite catalogue |
| S07 | Accept/reject live action-needed order | NOT TESTED | Would change a real Apple Review order |
| S08 | Seller messages `activeSellerId` | NOT TESTED | `/seller/messages` not opened this pass |
| S09 | Other-seller isolation | NOT TESTED | Only this seller session |
| S10 | Admin panel | NOT TESTED | Link visible; not opened |
| S11 | Public tables RLS | PASS | 0 public tables with RLS off |
| S12 | Storefront Mountain High Studio Cafe | PASS | Menu, Reviews (1), Search the menu, closed-now copy |

### Mobile / build

| ID | Case | Result | Evidence |
| --- | --- | --- | --- |
| M01 | Web buyer/seller UI | PASS | Localhost browser |
| M02 | iOS install / APNs / payment WebView | NOT TESTED | |
| M03 | Android FCM / channels | NOT TESTED | |
| M04 | Codemagic iOS | NOT RUN | Gates not met |

---

## 5. Defects

### Fixed this audit (retested)

| Sev | Defect | Root cause | Fix | Retest |
| --- | --- | --- | --- | --- |
| P1 | FTS search hit from a closed cafe showed ADD instead of Schedule (Dragon Non veg Momos vs Veg Momos, same seller) | `search_products_fts` omits hours. Merge used the raw FTS row | `stampSellerHoursFromInventory` copies hours from a sibling listing already on the page. Used in Home and Book/Contact | After HMR, Non veg Momos showed Closed today + Schedule. Targeted tests PASS |
| P2 | Vitest: ProductDeepLinkPage used `window.location.hash` | HashRouter path must come from `useLocation` | `useLocation().pathname` | Included in final 2590 PASS |
| P2 | Vitest: extra QA OTP phone `9535115316` | Bypass list too wide | Removed from `msg91-send-otp` (not deployed this run) | Source contract PASS. Edge deploy NOT TESTED |
| P3 | Stale source contracts (refund reminder type, Contact price label) | Tests lagged implementation | Tests updated to `payment_verify` and `getCommercePriceLabel` | PASS |
| UX | Closed+schedulable cards used grayscale/blur | Overlay applied whenever closed | Grayscale only when closed and not schedulable; Opens at chip kept | UI copy PASS. Pixel blur NOT screenshot-verified |
| UX | Book/Contact search left banners/tiles above listings | Search did not hide chrome | Hide tiles/banner when `searchActive` | Book `yoga` search PASS |
| UX | Labels Popular bookable / NEARBY SELLERS | Copy | Popular services / Browse listings | Live PASS |
| UX | Snacks chip preferred makhana photo | Ranking | Deprioritize makhana; prefer fries/pakoda | Unit PASS |
| P2 | Search suggestion overlay swallows the first listing tap | Listbox stole hits (`z-50`) | Panel `pointer-events-none`; options `pointer-events-auto` | Schedule under open suggestions went busy (2026-10-26) |
| P2 | Cart item vanished after visiting seller dashboard | Cart query gated off on `/seller*`; count split-brain | Keep cart query on seller routes; placeholderData; Header max while recovering | Biryani persisted after Profile -> Seller -> Cart |
| P2 | Overdue scheduled order stays Action needed | Future-only Upcoming filter; KPI used RPC | Exclude stale overdue from Action needed; prefer client aggregate counts | Chips `0 Action needed`; Apple Review remains under All |
| P3 | Dual Clear search (native type=search + custom X) | Two clear affordances | Search inputs `type="text"` + one Clear button | Home `dragon` search: 1 Clear button |
| P3 | Upcoming empty state missing from a11y tree | Screen readers missed copy | Empty state `role="status"` | Code + unit coverage; live empty filter not re-walked |

### Open

| Sev | Defect | Impact | Notes |
| --- | --- | --- | --- |
| P3 | Book catalogue includes ₹1 placeholder listings | Misleading | Data, not a code regression from this run |

No P0 found in executed paths. Paid money paths were not executed, so P0 checkout/payment is unknown, not passed.

---

## 6. Files changed (this session lineage)

| File | Why |
| --- | --- |
| `src/lib/listing-search.ts` | `stampSellerHoursFromInventory` |
| `src/components/home/MarketplaceSection.tsx` | Stamp FTS hits with local seller hours |
| `src/pages/CommerceModePage.tsx` | Same stamp; search-priority listings |
| `src/test/home-search-filters.test.ts` | Hours-stamp regression |
| `src/pages/ProductDeepLinkPage.tsx` | HashRouter `useLocation` |
| `supabase/functions/msg91-send-otp/index.ts` | Drop extra QA phone (deploy pending) |
| `src/components/product/ProductListingCard.tsx` (and grid/card) | No blur when schedule is offered |
| `src/lib/chip-listing-photo.ts` | Snack chip ranking |
| `src/lib/discovery-intents.ts` | Snack chip photo pool |
| `src/pages/GuidedDiscoveryHubPage.tsx` | Popular services / Browse listings |
| Tests under `src/test/` for search, chips, closed-store, guided discovery, commerce mode | Regression |
| `src/components/search/SearchAutocomplete.tsx` | Overlay pass-through so listing taps work |
| `src/hooks/useCart.tsx` / `src/hooks/useCartCount.ts` / Header cart badge | Persist cart on seller routes; heal count split-brain |
| `src/lib/scheduled-orders.ts` / `src/lib/seller-order-board.ts` | Overdue scheduled out of Action needed |
| `src/hooks/queries/useSellerOrders.ts` | Pending filter + client-first board counts |
| `src/pages/SellerDashboardPage.tsx` | Action needed KPI from filter counts |
| `src/pages/CommerceModePage.tsx` | `type="text"` search (single Clear) |
| `src/components/orders/BuyerUpcomingOrders.tsx` | Empty state `role="status"` |
| `src/test/seller-order-board.test.ts` / `scheduled-orders.test.ts` / `cart-empty-experience.test.ts` | Fix-pass regressions (29 targeted PASS) |

Do not treat untracked `.tmp-*` files as part of this audit.

---

## 7. Regression tests added

- `stampSellerHoursFromInventory` copies closed hours onto FTS rows from the same seller
- Home + CommerceModePage must call that helper
- Existing Blinkit search, Book/Contact `searchActive`, closed-store no-blur, snack chip, and Popular services / Browse listings contracts still pass
- Seller board: overdue scheduled excluded from Action needed; Upcoming stays future-only
- Cart route gating keeps `/seller*` cart queries enabled

Full suite (earlier): **2590 passed, 0 failed, 326 skipped**. Fix-pass targeted: **29 passed** (`seller-order-board`, `scheduled-orders`, `cart-empty-experience`).

---

## 8. Test records created and cleanup

| Record | Status |
| --- | --- |
| Scheduled cart add: Dragon Veg Momos ₹129 (first audit) | Never placed. Initially lost after seller visit; cart persistence fixed and retested with Biryani ₹99 |
| Cart retest item: Biryani ₹99 (Biryani and Kebab) | Left in buyer cart after retest. No `orders` row. Clear manually if unwanted |
| Biryani and Kebab settings | Unchanged by this agent (availability may have changed outside the session) |
| Products / prices / stock | Unchanged |
| Payments / refunds | None |
| Notifications sent by this run | None on purpose |

---

## 9. Release gates

| Gate | Status |
| --- | --- |
| Instant order E2E | NOT TESTED (paid) |
| Scheduled order E2E | PARTIAL (cart + seller labels). Paid + notify BLOCKED |
| Pre-order E2E | NOT TESTED |
| Booking / enquiry / contact | UI only. Submit NOT TESTED |
| Payment / inventory consistency | BLOCKED / NOT TESTED |
| Critical seller notifications on device | NOT TESTED |
| P0/P1 in executed web UI | P1 search-hours fixed. No remaining executed P0/P1 |
| Existing Vitest | PASS |
| Store config restored | N/A (never changed) |
| Codemagic iOS | **Not started** |

**Release: NO-GO.**

To unblock Codemagic iOS after this report:

1. Sandbox payment: one instant and one scheduled COD or Razorpay test order, then seller accept/reject, then DB + PNQ + UI assert.
2. Confirm a preorder-capable listing or explicitly waive pre-order for this release.
3. Device matrix: Android + iOS, app killed, seller closed, notification sound.
4. `npx cap sync ios` / Codemagic only after those, or if you explicitly override the gate.

`msg91-send-otp` source no longer includes `9535115316`. Deploy that function only if you want production OTP to match the repo.

---

## 10. Counts (executed this run)

| Bucket | Count | Notes |
| --- | --- | --- |
| Automated tests run | 2590 passed | 326 skipped, 7 files skipped |
| Distinct UI / DB cases in this matrix | 55 | 30 PASS after retest (was 27 + 3 FAIL), 6 BLOCKED, 19 NOT TESTED |
| Defects fixed | 1 P1, 5 P2, 3 P3, 4 UX | See section 5 (includes 2026-10-26 remediations) |
| Defects still open | 1 P3 | ₹1 placeholder Book catalogue data |
| Native / Codemagic | 0 | Not run |

These are not coverage percentages. BLOCKED and NOT TESTED are not passes.
