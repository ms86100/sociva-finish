# 01 - Complete Content Inventory

**Audit date:** 2026-11-10  
**Scope:** Sociva HashRouter app (`src/App.tsx`), pages, major components, native shell strings  
**Method:** Full route enumeration + source inspection of user-facing strings; rendered verification deferred to Phase 9  
**Surface:** ~115 routed screens, 127 page TSX files, ~570 component TSX files, no i18n layer

Clarity flags: `Clear` | `Unclear` | `Redundant` | `Inconsistent` | `Technical` | `Inappropriate` | `Leak`

Recommended replacements in this file are provisional; approved wording is in `02` / `04`. Status of fixes is tracked in `05`.

---

## Native / shell

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Shell | Boot / splash | All | Customer | Sociva; Your Society, Your Store | `index.html`, `AppSplashScreen` | Clear | Keep | Brand aligned |
| Shell | App name | All | Customer | Sociva | `capacitor.config.ts`, `strings.xml` | Clear | Keep | - |
| Android | Commute FG | Host/Guest | Customer | Sharing commute location | Kotlin commute service | Clear | Keep | Accurate |
| Android | Live delivery | Buyer/Seller | Customer | Accepted / Preparing / ... | `LiveDeliveryService.kt` | Clear | Align with order status glossary | Consistency |
| Dev | Staging banner | All | Internal | STAGING BUILD · {host} · not production | `StagingBanner` | Technical | Keep on staging only | Env awareness |

---

## Auth / onboarding / marketing

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Auth | Welcome | Guest | Customer | Welcome carousel copy | `/welcome` | Clear | Keep short | First-run |
| Auth | Landing | Guest | Customer | Marketing landing | `/landing` | Clear | Keep; avoid ops jargon | Marketing only |
| Auth | Sign in | Guest | Customer | Phone OTP flow | `/auth` | Clear | Please Sign In where needed | Familiar |
| Auth | Reset password | Guest | Customer | Reset password | `/reset-password` | Clear | Keep | - |
| Auth | Lazy fail | All | Customer | Updating Sociva / Continue | `App.tsx` LazyLoadFailed | Clear | Keep | Recoverable |

---

## Marketplace / buyer discovery

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Home | Home | Buyer | Customer | Home feed, category hubs | `/` | Clear | Keep; trim redundant banners | Noise |
| Search | Search | Buyer | Customer | Search | `/search` | Clear | Keep | - |
| Categories | Categories | Buyer | Customer | Categories | `/categories` | Clear | Keep | - |
| Category | Group page | Buyer | Customer | Category group | `/category/:category` | Clear | Keep | - |
| Explore | Guided hub | Buyer | Customer | Explore hub | `/explore/:hubId` | Clear | Keep | - |
| Discovery | Listings | Buyer | Customer | Discovery listings | `/discovery/:type` | Clear | Keep | - |
| Location | Discover location | Buyer | Customer | Location discovery | `/discover-location` | Clear | Keep | - |
| Commerce | Book | Buyer | Customer | Book mode titles | `/book` + `COMMERCE_MODE_COPY` | Clear | Book / Booking | Mode-specific |
| Commerce | Services | Buyer | Customer | Services / enquire | `/services` | Clear | Enquire / Contact seller | Mode-specific |
| Product | Deep link | Buyer | Customer | Product detail | `/product/:id` | Clear | Keep | - |
| Festival | Collection | Buyer | Customer | Festival collection | `/festival-collection/...` | Clear | Keep | - |
| Store | Seller storefront | Buyer | Customer | Store / seller name | `/seller/:id` | Inconsistent | Store for shop; Seller for person | One concept |
| Favourites | Favourites | Buyer | Customer | Favourites | `/favorites` | Clear | Keep (UK spelling OK if consistent) | - |
| Group buy | Collective | Buyer | Customer | Group buys | `/group-buys` | Clear | Keep | - |
| Community | Bulletin | Resident | Customer | Community | `/community` | Clear | Keep | - |
| Directory | Trust directory | Resident | Customer | Directory | `/directory` | Clear | Keep | - |

---

## Cart, checkout, orders, bookings, enquiries

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Cart | Cart | Buyer | Customer | Checkout one store at a time; View Store | `/cart` | Inconsistent | Store vs Seller: use Store for shop | Consistency |
| Orders | List | Buyer/Seller | Customer | Orders | `/orders` | Clear | Keep | - |
| Orders | Detail | Buyer/Seller | Customer | Fulfilment on {date}; Customer vs buyer | `/orders/:id` | Inconsistent | Order status / fulfilled on; Customer when seller-facing | Plain language |
| Checkout | Group detail | Buyer | Customer | Checkout details | `/checkouts/:groupId` | Clear | Keep | - |
| Disputes | Disputes | Buyer/Seller | Customer | Disputes | `/disputes` | Clear | Keep | - |
| Subscriptions | My subscriptions | Buyer | Customer | Subscriptions | `/subscriptions` | Clear | Keep | - |
| Order help | Help sheet | Buyer | Customer | Other issue | `OrderHelpSheet` | Clear | Keep | - |

---

## Seller onboarding and dashboard

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Onboarding | Become seller | Seller | Seller | Steps via `seller-onboarding-copy` | `/become-seller` | Clear | Keep; Audit for redundant paragraphs | Familiar actions |
| Seller | Dashboard | Seller | Seller | Seller dashboard | `/seller` | Clear | Keep | - |
| Seller | Products | Seller | Seller | Products / Add Product | `/seller/products` | Clear | Add Product | Action-oriented |
| Seller | Product form | Seller | Seller | Feature Flags; Service Add-ons enabled | DraftProductManager | Technical | Availability / add-ons | No feature-flag jargon |
| Seller | Category requests | Seller | Seller | Category requests | `/seller/category-requests` | Clear | Keep | - |
| Seller | Settings | Seller | Seller | Seller settings | `/seller/settings` | Clear | Keep | - |
| Seller | Earnings | Seller | Seller | Customer / buyer mix | `/seller/earnings` | Inconsistent | Customer for who ordered | Seller language |
| Seller | Wallet | Seller | Seller | Wallet | `/seller/wallet` | Clear | Keep | - |
| Seller | Credits | Seller | Seller | Sociva Credits | `/seller/credits` | Clear | Keep | - |
| Seller | Payouts | Seller | Seller | Payouts | `/seller/payouts` | Clear | Keep | - |
| Seller | Messages | Seller | Seller | Messages | `/seller/messages` | Clear | Keep | - |

---

## Payments / wallet / credits / refunds (admin + seller)

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Admin | Refunds | Admin | Admin | Refunds | `/admin/refunds` | Clear | Keep | Admin OK |
| Admin | Seller payouts | Admin | Admin | Seller payouts | `/admin/seller-payouts` | Clear | Keep | - |
| Admin | Seller credits | Admin | Admin | Monetization | `/admin/seller-credits` | Unclear | Seller credits | Match seller UI |
| Admin | Financial trace | Admin | Admin | Financial trace | `/admin/financial-trace` | Clear | Keep (admin) | - |
| Admin | Financial controls | Admin | Admin | Financial controls | `/admin/financial-controls` | Clear | Keep | - |
| Legal | Refund policy | All | Customer | Refund policy | `/refund-policy` | Clear | Keep | - |
| Legal | Pricing | All | Customer | Pricing | `/pricing` | Clear | Keep | - |

---

## Profile, account, notifications

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Profile | Profile | Resident | Customer | Help & Guide; NotificationHealthCheck detail | `/profile` | Leak / Technical | Hide tech detail from residents | Leakage |
| Profile | Edit | Resident | Customer | Personal details | `/profile/edit` | Clear | Personal Details | Familiar |
| Notifications | Settings | Resident | Customer | Notifications | `/notifications` | Clear | Keep | - |
| Notifications | Inbox | Resident | Customer | Inbox | `/notifications/inbox` | Clear | Keep | - |
| Support | Talk to Sociva | All | Customer | Talk to Sociva | `/talk-to-sociva` | Clear | Keep | - |
| Support | Help | All | Customer | Help; Consumer Protection (legal) | `/help` | Clear | Keep Consumer in legal only | Legal exception |
| Account | Delete | All | Customer | Delete account | `/delete-account` | Clear | Keep | - |

---

## A Cleaner City (production)

Product name in UI: prefer **A Cleaner City**. Code path: `/cleaner-city`. Docs/E2E may say Green City.

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| CC | Home | Host/Guest | Customer | A Cleaner City / Cleaner City / sociva cleaner city | Page + EntryCard | Inconsistent | A Cleaner City | Brand |
| CC | Home | Guest | Customer | How it works ... OTP; % overlap; demo rides | CleanerCityPage | Technical / Leak | Pickup code; soft match copy; empty state | Leak + clarity |
| CC | Nav | Host/Guest | Customer | Play / Missions | BottomNav | Unclear | Find / My rides | Familiar commute |
| CC | Find | Guest | Customer | Riders on your route; Passenger holds... | FindPage | Inconsistent | Guests / Guest | Host/Guest standard |
| CC | Offer | Host | Customer | Riders appear; Optional matching pins; fuel share | OfferPage | Technical | Guests; Optional pins; Fuel contribution | Standard |
| CC | Ride | Both | Customer | admin petrol price; Guest contribution; Host share | RidePage | Leak / Inconsistent | Fuel contribution; hide admin config | Leak |
| CC | Ride actions | Both | Customer | Show code to your rider (inverted) | RidePrimaryActions | Inappropriate | Show to your host | Correct actor |
| CC | Match card | Guest | Customer | Match power; % road overlap | MatchCard | Technical | Good route match | Plain language |
| CC | Rides list | Both | Customer | Your runs; Live quests | RidesPage | Unclear | My rides; Active and past rides | No game jargon |
| CC | Profile hub | Both | Customer | Your loadout; Trust / Gear / Comms | ProfileHub | Unclear | Your profile; plain groups | No RPG |
| CC | Setup / schedule / vehicle / route | Both | Customer | Host/Guest setup | Setup pages | Clear | Keep Host/Guest | Already good |
| CC | Circles / safety / chat / share | Both | Customer | Blocked riders | Safety | Inconsistent | Blocked guests / neighbours | Standard |
| CC | Host offer card | Host | Customer | Riders on this offer; published status; lat/lng | HostOfferRideCard | Technical | Guests; human status; hide coords | Clarity |

---

## Cleaner City prototype

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| CC Proto | All | Reviewer | Internal | Demo code; Admin resolution... | `/cleaner-city/prototype/*` | Leak | Gate to admin or DEV | Not resident UX |

---

## HelpHub

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| HelpHub | Hub / find / recommend / work / listing | Resident | Customer | HelpHub flows | `/help-hub/*` | Clear | Keep; trim noise | - |
| HelpHub | Demo | Tester | Internal | ?demo=1 mock workers / phones | demo-store | Leak | Keep off prod paths | Leakage |

---

## Society / builder / security / workforce / delivery

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Society | Dashboard / finances / notices / ... | Member | Customer | Society ops labels | `/society/*` | Clear | Vendor Name OK for expenses | Domain exception |
| Builder | Dashboard / analytics / inspections | Builder | Ops | Builder | `/builder*` | Clear | Keep | Role-specific |
| Security | Guard kiosk / audit | Security | Ops | Guard | `/guard-kiosk` | Clear | Keep | - |
| Visitors / Parking / Parcels | Ops pages | Resident/Ops | Mixed | Management labels | Various | Clear | Audit redundant help text | Noise |
| Workforce | Hire / jobs / attendance / salary | Ops/Worker | Mixed | Worker | Various | Clear | Keep Worker | Distinct from Guest |
| Delivery | Partners / my deliveries | Ops | Ops | Delivery partner | Mgmt routes | Clear | Keep | - |

---

## Admin

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Admin | Main / command / stores / ... | Admin | Admin | Admin tools | `/admin/*` | Clear | Polish unclear labels only | Keep capability |
| Admin | Orphan | Admin | Admin | Service bookings page unwired | AdminServiceBookingsPage | - | Document only | Not in router |

---

## Legal

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Legal | Privacy / Terms / Community rules | All | Customer | Legal copy; Consumer Protection | Legal pages | Clear | Keep legal terms | Exception |

---

## Debug / internal (must not be resident-facing)

| Module | Screen | Role | Audience | Current text (sample) | Where | Flag | Recommended | Reason |
|--------|--------|------|----------|----------------------|-------|------|-------------|--------|
| Debug | Push debug | Anyone today | Internal | FCM tokens, BUILD_ID | `/push-debug` | Leak | AdminRoute | Gate |
| Debug | Live Activity debug | Anyone today | Internal | entity ids, KV dump | `/la-debug` | Leak | AdminRoute | Gate |
| Docs | Platform docs | Anyone today | Internal | RLS, notification_queue, feature flags | `/docs` | Leak | AdminRoute | Gate |
| Admin | Test results / API docs | Admin | Admin | QA / API | AdminRoute | Clear | Keep gated | OK |

---

## Notification copy sources (not screens)

| Source | Audience | Notes |
|--------|----------|-------|
| `notification_templates` migrations | Customer | Canonical push/in-app |
| SQL triggers / queue inserts | Customer | Order, CC, HelpHub |
| `notification-display-copy.ts` | Customer | Fallback titles/bodies |
| Edge functions (cron, alerts) | Customer | Inline title/body |

Phase 8 changes notification wording only when it violates glossary; delivery logic unchanged.

---

## Inventory counts (evidence)

| Metric | Count |
|--------|------:|
| Routed screens (excl. redirects / catch-all) | ~115 |
| Page TSX files | 127 |
| Component module folders | 70 |
| Inventory rows in this document (screen-level) | 95+ |
| High-priority unclear / leak / inconsistent (for Phase 8) | 40+ (see `03`) |

Detailed string-level before/after lives in `05-before-after-copy-changes.md` after remediation.
