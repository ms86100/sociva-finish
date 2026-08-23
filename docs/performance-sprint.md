# Performance sprint — first paint & navigation (2026-08-07)

## Goals
1. First meaningful paint / usable shell in **&lt; 3s** on mid mobile where possible  
2. Home/feed interactive quickly; images progressive  
3. Route transitions feel instant (code-split + idle prefetch)  
4. Remove black-screen / SplashGate / double-spinner waterfalls  

## Live evidence (www.sociva.in, before this deploy)

| Observation | Implication |
|---|---|
| Early screenshot: solid black before chrome | Users perceive “broken” during JS + auth |
| App chunk ~352KB decoded + icons ~410KB + motion | Eager bottom-nav pages inflated cold parse |
| `get_user_auth_context` ~3.2s | Marketplace waited on society coords |
| Full `cart_items` JOIN raced Home | Contended with discovery RPCs (~5s wall) |
| `category_status_flows` ×3, banners refetchOnMount | Extra work on every Home visit |
| Unused `public/splash-video.mp4` (~2.9MB) | Deploy/CDN noise; orphaned after splash rewrite |
| `public/downloads/sociva-android.apk` (~63MB) | Still hosted for download — P2 to offload |

## Root causes (ranked)

1. **Eager Cart/Orders/Profile/Society/Search** in `App.tsx` — Razorpay, calendars, wallets in main chunk  
2. **Dual gates** — SplashGate + AppShellGate spinner after splash while profile still loading  
3. **Splash used framer-motion** + min 700ms + 400ms exit — unnecessary critical-path cost  
4. **Marketplace blocked on lat/lng** until auth context society resolved (no last-known coords)  
5. **Heavy cart JOIN on `/` immediately** — competed with sellers/products  
6. **Product cards skipped `optimizedImageUrl`** — full-size images on listing grids  
7. **FeaturedBanners `refetchOnMount: true`** — ignored global staleTime  
8. **GlobalSellerAlert for all users** — buyer boots still entered alert machinery  

## Changes shipped

### Phase A — First paint / bootstrap
- `AppSplashScreen`: CSS-only overlay; min **280ms**, max **1.6s**, exit **180ms** (no framer-motion)
- `AppShellGate` / `ProtectedRoute`: gate on **`isSessionRestored` only**; return `null` under splash (no second spinner)
- Public auth routes: `sessionPending = !isSessionRestored`; authed redirect when `user` exists (don’t wait for profile)
- Lazy-load Cart, Orders, Profile, Society, Search; **Home stays eager**
- Idle prefetch of bottom-nav + secondary routes (`route-prefetch.ts`)
- Bump `BUILD_CACHE_VERSION` → `fast-first-paint-v2` (clears stale Workbox once)
- **2026-08-23:** Slim SW precache to shell assets only (was ~447 JS chunks / ~10MB → 20–30s installs + `clients.claim` races). Bump → `slim-sw-precache-v3`.

### Phase B — Data
- Persist **last browsing coords** (`sociva_last_browsing_coords`) so marketplace can start before society RPC
- Defer full cart JOIN on Home by **~1.2s** (badge still uses light `cart-count`)
- Remove FeaturedBanners `refetchOnMount: true`
- Mount seller order-alert stack **only when `isSeller`**

### Phase C — Images
- `ProductListingCard`, `ProductCard`, `ProductGridCard` → `optimizedImageUrl` + `decoding="async"` + error fallback
- Delete unused `public/splash-video.mp4`

### Phase D — Navigation
- Prefetch Search → Orders → Cart → Society → Profile first after idle
- Persistent `AppShell` unchanged (Header/BottomNav stay mounted)

## Before / after hypotheses

| Metric | Before (hypothesis) | After (hypothesis) |
|---|---|---|
| Time to branded splash | Instant HTML only if deployed; else black | Instant HTML `#boot-splash` + fast CSS splash |
| Main JS parse for Home | App + Cart/Orders/… payment stack | App + Home only; tabs load on demand / idle |
| Splash overlay duration | 700ms min + up to 2.5s + 400ms fade | ~280ms min, hard cap 1.6s, 180ms fade |
| Post-splash blank | AppShellGate spinner while profile loads | Shell + Home skeletons immediately |
| Marketplace first sellers | After society coords from auth RPC | Immediate if last-known coords cached |
| Listing image bytes | Full originals | ~300w WebP via Supabase render |

## How to verify on phone

1. Hard refresh https://www.sociva.in (or clear site data once for SW bump)  
2. Cold open: SOCIVA splash should appear in **&lt;1s**, shell/Home in **a few seconds** (not 1–2 min)  
3. Images: placeholders → progressive sharpen (not empty white cards)  
4. Tap Orders / Cart / Search: brief Suspense skeleton first time, then instant on revisit  
5. Buyer (non-seller): no order-bell network / sound preload on boot  
6. Airplane → online: app still recovers; cart badge still accurate  

## Remaining backlog (P2)

- [ ] Host APK outside `public/` (R2/S3) — 63MB bloats every Vercel deploy  
- [ ] Slim `cart_items` product select (drop `products(*)`) without breaking checkout  
- [ ] Dedupe `category_status_flows` fetches via shared react-query key on Home  
- [ ] Defer `service_bookings` / notification preference reads until Orders / Settings  
- [ ] Compress `splash-screen.png` / app icons (~900KB each)  
- [ ] Consider CSS for more first-paint motion (GroupedSellerRow) to shrink motion chunk usage on Home  
- [ ] Capacitor APK rebuild after web bake — **skipped this sprint** (web-first); rebuild when packaging next native release  

## Deploy note

Web is served from **Vercel ← `master`**. Perf fixes are committed and pushed so production can pick them up. Native APK rebuild optional; web users feel changes without a store update.
