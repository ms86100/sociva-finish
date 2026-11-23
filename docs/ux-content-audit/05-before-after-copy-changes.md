# 05 - Before / After Copy Changes

**Status column:** `Fixed` = code updated and covered by source or rendered check; `Documented` = intentional leave / backlog; `Verified` = confirmed in rendered UI this session.

| Module | Screen | Existing text | Recommended text | Reason | Status |
|--------|--------|---------------|------------------|--------|--------|
| Debug | `/docs` | Public DocumentationPage | Admin-only | Internal architecture leak | Fixed |
| Debug | `/push-debug` | Ungated push diagnostics | Admin-only | Token / BUILD_ID leak | Fixed |
| Debug | `/la-debug` | Ungated live activity dump | Admin-only | Entity ID leak | Fixed |
| Debug | `/cleaner-city/prototype/*` | Ungated prototype | Admin or DEV only | Not resident UX | Fixed |
| App | Global mutation toast | Raw `error.message` | `friendlyError(error)` | Technical toast leak | Fixed |
| Profile | Profile | NotificationHealthCheck for all | Admin only | Technical detail leak | Fixed |
| CC | Entry card | sociva cleaner city | A Cleaner City | Brand consistency | Fixed |
| CC | Entry card | Live mission / Continue mission | Active ride / Continue ride | Avoid Mission jargon | Fixed |
| CC | Bottom nav | Play / Missions | Find / My rides | Familiar commute IA | Fixed |
| CC | Home | HOME_DEMO_RIDES fake hosts | Empty list + empty state | Dummy content leak | Fixed |
| CC | Home | How it works ... OTP / corridor | ... pickup code / route pins | Plain language | Fixed |
| CC | Home | Example corridor rides / % overlap | No rides yet / Similar route | Soften engine metrics | Fixed |
| CC | Home | Open Missions / shared cost | Open My rides / fuel contribution | Glossary | Fixed |
| CC | Match card | Match power / % road overlap | Good route match / Similar route | Soften engine metrics | Fixed |
| CC | Match card | Fuel share TBD | Fuel contribution TBD | One money noun | Fixed |
| CC | Ride actions | Show to rider / passenger | Show to host / guest | Correct actors | Fixed |
| CC | rideMissionCopy | passenger / rider hints | guest / host hints | Correct actors | Fixed |
| CC | Ride page | admin petrol price | distance and petrol price | Remove admin leak | Fixed |
| CC | Ride page | Fuel share / Guest contribution / Host payout payable | Fuel contribution / Host receives | One money noun; no payout jargon | Fixed |
| CC | Rides list | Your runs / Live quests | My rides / Active seats... | No game jargon | Fixed |
| CC | Profile hub | Your loadout / Trust Gear Comms | Your profile / Safety Vehicle Messages | Plain language | Fixed |
| CC | Profile hub | Corridor unlocked/locked | Route ready / Set your route pins | Soften corridor | Fixed |
| CC | Find | Riders on your route / Passenger holds | Guests... / Guest holds | Host/Guest standard | Fixed |
| CC | Find | Raw `e.message` toasts | Friendly fixed messages | Technical errors | Fixed |
| CC | Offer | Riders appear / matching pins / fuel share / guest | Guests / stop pins / fuel contribution | Glossary | Fixed |
| CC | Safety | Blocked riders | Blocked neighbours | Glossary | Fixed |
| CC | Host offer card | status enum / lat,lng / Riders | Live/Draft labels / point set / Guests | Technical leak | Fixed |
| CC | Route banner | published polyline / corridor | published route / road route | Soften internals | Fixed |
| CC | Route setup | Guest path - pins only | Guest route - pickup and office pins | Clarity | Fixed |
| CC | matchCopy | Good corridor fit / Weak route fit | Good route match / Weaker route match | Soften | Fixed |
| CC | Drop run | haversine_fallback · approximate | approximate route (no provider name) | Soften | Fixed |
| Orders | Order detail | Fulfilment on {date} | Fulfilled on {date} | Plain language | Fixed |
| Seller | Product form | Feature Flags / enabled | Available for this category / available | No flag jargon | Fixed |
| Admin | Seller credits boundary | Monetization | Seller Credits | Match seller UI | Fixed |
| Shared | ux-copy/common.ts | (none) | Central repeated strings | Consolidation | Fixed |
| CC | Find/Offer/Rides/Route headers | Play · Find / Missions / Corridor unlocked · Play | Find / Offer / My rides / Route ready · Find | Remove Play/Missions | Fixed |
| CC | Home footer link | Missions | My rides | Glossary | Fixed |
| Marketplace | Cart Store vs Seller | Mixed | Prefer Store for shop | Partial - inventory documented | Documented |
| HelpHub | ?demo=1 | Mock workers | Keep flag-gated only | Documented; no prod entry | Documented |
| Notifications | SQL/edge templates | Mixed Customer/Buyer | Align over time | Out of client-only pass | Documented |
| Society | Many ops pages | Long helper copy | Trim in follow-up | Inventory only this pass | Documented |
| Native | Android/iOS labels | Channel titles | Web-parity check | Native untested this pass | Documented |
