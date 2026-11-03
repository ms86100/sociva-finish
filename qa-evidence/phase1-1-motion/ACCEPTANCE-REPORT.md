# Sociva Phase 1.1 - Visual Acceptance, Buyer Simulation, Regression Audit

Date: 2026-11-03  
Environment: Local Vite preview `http://127.0.0.1:4173` against production Supabase `kkzkuyhgdvyecmxtmkpy`  
Buyer: Apple Review OTP `0123456789` / `1234`  
Location: Shriram Greenfield (13.07, 77.75)

## Verdict

**Phase 1 is NOT fully accepted as a complete premium UX certification.**

Core marketplace motion and content-aware placeholders work in a real buyer session on web. Several Phase 1 primitives remain unused, true before/after baselines were never captured, and Android/iOS device evidence is absent. Defects found in this audit were fixed in code; remaining gaps are classified honestly below.

---

## A. Screenshots (after fixes)

| File | Screen |
|------|--------|
| [01-home-marketplace.png](01-home-marketplace.png) | Home with real Greenfield listings, chips, banners |
| [02-category-home-food-grid.png](02-category-home-food-grid.png) | Category grid (32 Home Food items) |
| [03-product-detail-sheet.png](03-product-detail-sheet.png) | Product detail sheet - Chicken Curry |
| [04-cart-with-item.png](04-cart-with-item.png) | Cart with real item + Added-to-cart feedback |
| [05-book-commerce.png](05-book-commerce.png) | Book / services commerce mode |

**Before screenshots:** NOT IMPLEMENTED (no pre-Phase-1 baseline captured). After-only evidence only.

---

## B. Real buyer journey results

| Step | Result | Evidence |
|------|--------|----------|
| 1. Open Sociva | PASS - splash then auth/home | Live session |
| 2. Initial marketplace loading | PASS after fix - `marketplace-status-loading` + ProductGridSkeleton | Code + contract test |
| 3. Wait for real marketplace data | PASS - Home Food, pickles, selling-well rails with real prices | 01-home |
| 4. Navigate categories | PASS - Home Food chip -> `/category/food_beverages?sub=home_food` | 02-category |
| 5. Commerce section | PASS - `/book` shows Salon / Beauty / Medical with nearby counts | 05-book |
| 6. Scroll product grids | PASS - 32 Home Food cards, images loaded | 02-category |
| 7. Open real product | PASS - Chicken Curry sheet (₹249, KHATMITTHI) | 03-pdp |
| 8. Product gallery | PARTIAL - hero image revealed; multi-image carousel not exercised | 03-pdp |
| 9. Pack-size variant | NOT VERIFIED - selected product had no size picker | - |
| 10. Add to cart | PASS - badge became `1` | CDP + cart |
| 11. Change quantity | PARTIAL - stepper present; accidental remove observed when probing | 04-cart |
| 12. Floating cart | PASS - add feedback / cart chrome observed | session |
| 13. Navigate to cart | PASS - 1 item, COD, delivery, schedule, Place Order | 04-cart |
| 14. Update/remove item | PASS - remove confirmation modal shown | 05-book overlay |
| 15. Proceed to checkout | NOT VERIFIED - Place Order not clicked (would create real order) | intentional |
| 16. Checkout loading | IMPLEMENTED BUT NOT VERIFIED in session - CheckoutSkeleton wired | code |
| 17. Payment without unauthorized charge | PASS - stopped before Place Order | policy |
| 18. Success only after genuine confirmation | PASS (code) - OrderSuccessOverlay gated on `fromCheckout` | contract test |

---

## C. Visual defect register

### DEF-01 - Home initial load had no content-aware skeleton
- **Screen:** Home / MarketplaceSection  
- **Component:** MarketplaceSection  
- **Repro:** Cold load with location set while marketplace query in flight  
- **Expected:** ProductGridSkeleton matching food cards  
- **Actual:** Empty/slow-only path until content or empty state  
- **Root cause:** `marketplaceStatus === 'loading'` fell through without skeleton UI  
- **Severity:** High  
- **Fix:** IMPLEMENTED - early loading return with ProductGridSkeleton + chip rail  

### DEF-02 - Base Skeleton shimmer ignored reduced-motion
- **Screen:** All skeleton surfaces  
- **Component:** `components/ui/skeleton.tsx`, `index.css`  
- **Repro:** OS prefers-reduced-motion: reduce  
- **Expected:** Static placeholder, no sweep  
- **Actual:** Tailwind shimmer continued  
- **Root cause:** Only `.product-image-shimmer` was gated  
- **Severity:** Medium  
- **Fix:** IMPLEMENTED - `motion-safe:` class + `[data-skeleton]` CSS override  

### DEF-03 - Nested card entrance wrappers
- **Screen:** Commerce / category / search / home filtered grids  
- **Component:** Parent `motion.div` + ProductListingCard `cardEntrance`  
- **Repro:** Open shop/category grid  
- **Expected:** Single stagger entrance  
- **Actual:** Extra wrapper variants (risk of double motion / layout wrappers)  
- **Root cause:** Phase 1 wiring wrapped cards already owning variants  
- **Severity:** Medium  
- **Fix:** IMPLEMENTED - wrappers removed; ProductListingCard is stagger child  

### DEF-04 - Category chip selected scale felt artificial
- **Screen:** Home DiscoveryChipRail  
- **Component:** DiscoveryChipRail ChipButton  
- **Repro:** Select chip  
- **Expected:** Subtle press feedback only  
- **Actual:** Continuous selected scale `1.02`  
- **Severity:** Low  
- **Fix:** IMPLEMENTED - removed selected scale; kept whileTap  

### DEF-05 - Cached images still flashed shimmer
- **Screen:** Product cards  
- **Component:** ProductListingCard / ProductCard image path  
- **Repro:** Revisit grid with browser-cached images  
- **Expected:** Instant show when `img.complete`  
- **Actual:** Brief shimmer possible  
- **Severity:** Medium  
- **Fix:** IMPLEMENTED - `ref` checks `complete` / `naturalWidth`  

### DEF-06 - Motion primitives largely unused by screens
- **Screen:** Architecture  
- **Component:** MotionPage, MotionCard, MotionImage, MotionList, MotionModal, MotionBottomSheet, ContentLoadState  
- **Repro:** Grep imports from `@/components/motion`  
- **Expected:** Screens consume central primitives  
- **Actual:** Screens use Framer + skeleton kits directly; MotionImage unused  
- **Severity:** Medium (maintainability)  
- **Fix:** NOT IMPLEMENTED this pass - classified PARTIALLY; avoided risky rewrite mid-audit  

### DEF-07 - Profile / orders / notifications skeleton kits unused
- **Screen:** Profile, Orders, Notifications  
- **Component:** MarketplaceShellSkeletons kits  
- **Severity:** Low for Phase 1 buyer scope  
- **Fix:** NOT IMPLEMENTED - kits exist, pages keep prior skeletons  

### DEF-08 - Web guest marketplace blocked without localhost exception
- **Screen:** Web marketing gate  
- **Component:** AppShellGate  
- **Repro:** Signed-out web visit to `/`  
- **Expected (QA):** Ability to exercise marketplace locally  
- **Actual:** Redirect to `/landing` on production web (intentional); blocked local QA  
- **Severity:** Medium for verification only  
- **Fix:** IMPLEMENTED - localhost/127.0.0.1 guest browse allowed; production unchanged  

---

## D. Performance measurements (web preview)

| Metric | Value | Notes |
|--------|-------|-------|
| CLS (sampled on `/book` after load) | 0 | Layout-shift entries after navigation; not a full cold-start CLS lab run |
| First Contentful Paint (nav timing sample) | ~2116 ms | Includes auth/session restore path noise |
| Console errors (hooked) | none observed | Limited to late-session hook |
| New animation libraries | none | Framer Motion 12 only |
| Bundle | existing framer-motion retained | No GSAP/Rive/Three/Remotion |

Vaul drawer (PDP), Radix dialogs, Embla carousels, and bottom nav remained functional during the session.

---

## E. Regression tests

| Suite | Result |
|-------|--------|
| `phase11-motion-regression.test.ts` | 4 passed |
| `motion-system.test.ts` | 2 passed |
| `placeholder-kits.test.tsx` | 4 passed |
| `commerce-mode-ui-contracts.test.ts` | 6 passed |
| **Total this audit** | **16 passed** |

---

## F. Acceptance matrix

| Area | Classification |
|------|----------------|
| Motion module (`src/lib/motion/*`) + barrel | IMPLEMENTED AND VERIFIED |
| Content-aware placeholders (product/cart/checkout/search/category) | IMPLEMENTED AND VERIFIED |
| Home loading skeleton | IMPLEMENTED AND VERIFIED (fixed in 1.1) |
| Home / category / book buyer grids with real data | IMPLEMENTED AND VERIFIED |
| Product detail sheet open + image | IMPLEMENTED AND VERIFIED |
| Add to cart + header badge | IMPLEMENTED AND VERIFIED |
| Cart page with real item | IMPLEMENTED AND VERIFIED |
| Reduced-motion skeleton + product shimmer | IMPLEMENTED AND VERIFIED (fixed in 1.1) |
| Order success gated on real checkout | IMPLEMENTED AND VERIFIED (code + contract) |
| Motion* primitives adopted by screens | PARTIALLY IMPLEMENTED |
| Image blur-up / cache flash | IMPLEMENTED BUT NOT VERIFIED (slow-network lab not run) |
| Variant / pack-size motion | NOT VERIFIED |
| Checkout progress + payment UI | IMPLEMENTED BUT NOT VERIFIED (no Place Order) |
| Before/after screenshot pairs | NOT IMPLEMENTED |
| Android device verification | NOT VERIFIED |
| iOS device verification | NOT VERIFIED |
| Full CLS / FPS lab profile | PARTIALLY IMPLEMENTED |

---

## Fixes shipped in Phase 1.1

1. Home `loading` -> ProductGridSkeleton  
2. Skeleton reduced-motion gating  
3. Remove nested cardEntrance wrappers  
4. Soften DiscoveryChipRail motion  
5. Cached-image complete check  
6. Localhost guest browse for QA  
7. Phase 1.1 regression contracts  

## Explicit non-starts

- Phase 2 seller motion  
- Phase 3 Cleaner City motion  
- New animation libraries  
