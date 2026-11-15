# Sociva mobile size - before / after (measured)

Date: 2026-11-15

## Before (baseline)

| Metric | Size | Evidence |
|--------|-----:|----------|
| Native synced web assets | 56.22 MB | `dist/` / `android/.../assets/public` |
| `pamphlets/` in native | 37.56 MB | present |
| `menu/` in native | 2.72 MB | present |
| Play AAB `sociva-play-2.0.85.aab` | 55.00 MB | repo root |
| JS in `dist/assets` | ~8.97 MB | prior inventory |
| `lucide-registry` chunk | ~350 KB | full `icons` import |

## After (this change set)

| Metric | Size | Evidence |
|--------|-----:|----------|
| Native synced web assets | **15.60 MB** | `npm run build:native` then measure `dist/` |
| `pamphlets/` in native | **absent** | Vite omit plugin + APK/AAB zip scan = 0 entries |
| `menu/` in native | **absent** | same |
| Release APK | **13.43 MB** | `android/app/build/outputs/apk/release/app-release.apk` |
| Release AAB | **14.58 MB** | `android/app/build/outputs/bundle/release/app-release.aab` |
| JS in `dist/assets` | **8.63 MB** | after Lucide allowlist |
| `lucide-registry` chunk | **14 KB** | `dist/assets/lucide-registry-*.js` |

## Reduction

| Metric | Before | After | Reduction |
|--------|-------:|------:|----------:|
| Native web assets | 56.22 MB | 15.60 MB | **40.62 MB (72%)** |
| Android AAB | 55.00 MB | 14.58 MB | **40.42 MB (73%)** |
| Android APK (release) | ~55 MB class (AAB era) / prior fat | 13.43 MB | ~**41 MB** vs prior Play AAB |

Play device download size still needs `bundletool get-size` or Play Console after upload (AAB upload size is not the same as download size).

## Web vs native isolation proof

| Build | pamphlets | menu | sounds |
|-------|-----------|------|--------|
| `vite build` → `dist-web-verify/` | present (37.56 MB) | present | present |
| `npm run build:native` → `dist/` | removed | removed | present |
| Release APK / AAB | 0 matching entries | 0 | present (`assets/public/sounds/*` + `res/raw` / obfuscated `res/*.mp3`) |

Dependency report: [mobile-size-asset-dependency-report.md](./mobile-size-asset-dependency-report.md)

## Changes made

1. **Vite** `omitWebOnlyFromNativeDist` strips `downloads/`, `pamphlets/`, `menu/` on Capacitor / native prod builds only.
2. **Lucide** allowlist registry from production DB icons + code fallbacks (no full `icons` map).
3. **Deps** removed unused `leaflet`, `react-leaflet`, `lottie-react`, JS `firebase`, `@types/leaflet`; moved `@playwright/test` to `devDependencies`.
4. **Android R8** `minifyEnabled true` + `shrinkResources true` with Capacitor/Firebase/app keep rules; Codemagic android release rewrite updated to match.
5. **Seller alert sounds** fixed for shrinker: `R.raw.gate_bell` references + `res/values/keep.xml` (string-only URIs had caused `gate_bell` to be stripped).

## Preserved (not removed)

- Seller notification sounds (web + `res/raw`)
- Firebase Messaging / Crashlytics
- Capacitor plugins (push, local notifications, camera, geo, calendar, etc.)
- Payments / maps / admin swagger (lazy chunks still packaged for admin-on-device)

## Tests run

- `vitest`: `dynamic-icon-registry`, `ios-time-sensitive`, `seller-notification-remediation` - **14/14 passed**
- Android `:app:assembleRelease` + `:app:bundleRelease` - **BUILD SUCCESSFUL** with R8

## iOS IPA

Not rebuilt in this session. Codemagic `ios-release` needs these changes committed and pushed, then a workflow trigger. Native omit applies to iOS www via the same Vite plugin when CI runs `CAPACITOR_ENV=production`.

## Remaining size contributors (native)

1. JS chunks (~8.6 MB) - swagger-ui, AdminPage, livekit, Amplitude/session-replay
2. Sounds (~1.85 MB web + ~1.3 MB raw duplicates)
3. Splash / icons / product-images
4. DEX after R8 (smaller than pre-R8)

## Known limitations

- Device Play download estimate not measured here.
- Full marketplace / seller E2E on device not re-run in this pass (unit + build evidence only for alerts path).
- Splash/icon PNG recompression left as incremental follow-up (~1.8 MB public PNGs).
- Duplicate identical `logo.png` in `public/` and `src/assets/` still exists (same hash); web path `/logo.png` requires the public copy.
