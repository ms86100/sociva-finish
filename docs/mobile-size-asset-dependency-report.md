# Mobile size - asset dependency report (native vs web)

Generated before excluding web-only marketing assets from Capacitor native builds.

## Baseline (pre-change, measured on disk)

| Path | Size |
|------|-----:|
| `dist/` | 56.22 MB |
| `dist/pamphlets/` | 37.56 MB |
| `dist/menu/` | 2.72 MB |
| `dist/assets/` (JS/CSS) | 10.37 MB |
| `dist/sounds/` | 1.85 MB |
| `android/app/src/main/assets/public` | 56.22 MB |
| `sociva-play-2.0.85.aab` | 55.00 MB |

## Candidates for native exclusion

### `public/pamphlets/` (~37.56 MB)

| Check | Result |
|-------|--------|
| React route imports | None |
| `src/` code references | One comment only (`chip-listing-photo.ts`) - not a runtime load |
| Dynamic asset loaders | None found for `/pamphlets` |
| App WebView navigation to `/pamphlets` | None found in router / deep links |
| Static web pages | Yes - `public/pamphlets/*.html` for sociva.in marketing/print |
| PWA precache | Already excluded in `vite.config.ts` |

Largest files: trifold PNGs (12.49 / 6.55 / 5.94 MB), HTML exports, brand-hero.

**Decision:** Keep on **web** builds. Strip from **native** Capacitor `dist` (same pattern as `downloads/`).

### `public/menu/` (~2.72 MB)

| Check | Result |
|-------|--------|
| React / `src` references to `/menu/` paths | None |
| Required by marketplace product images | No - product media comes from Supabase URLs |
| Static folder contents | Local food photo JPGs/PNGs |

**Decision:** Keep on **web** builds. Strip from **native** Capacitor `dist`.

### Must retain in native

| Asset / capability | Why |
|--------------------|-----|
| `public/sounds/*.mp3` + Android `res/raw` + iOS `gate_bell.caf` | Seller order alerts |
| JS/CSS under `dist/assets` | App routes |
| Splash / icons used by shell | Launch UX |
| Firebase Messaging / Crashlytics / Capacitor plugins | Push, reliability, native APIs |
| Maps / geolocation / payments | Core features |

### Not excluded

| Path | Reason |
|------|--------|
| `public/downloads/` | Already stripped from native |
| Admin / ApiDocs swagger chunks | Lazy-loaded; admin still needs them on device |
| Notification sounds | Required |

## Verification after implementation

| Check | Result |
|-------|--------|
| Web build (`dist-web-verify`) still has pamphlets/menu | Yes (pamphlets 37.56 MB) |
| Native `dist/` after `build:native` | pamphlets/menu **absent**; total **15.60 MB** |
| Android assets after `cap sync` | pamphlets/menu **absent** |
| Release APK/AAB zip scan for pamphlets/menu | **0** entries |
| Seller sounds in AAB | `assets/public/sounds/*` + `res/raw/gate_bell.mp3` + `order_ring.mp3` |
| Final release APK / AAB | **13.43 MB** / **14.58 MB** |

Full before/after: [mobile-size-before-after.md](./mobile-size-before-after.md)

iOS IPA: pending Codemagic after commit/push (same Vite omit applies under `CAPACITOR_ENV=production`).
