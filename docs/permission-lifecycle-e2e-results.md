# Permission lifecycle + guest discovery E2E results

Branch: `feature/permission-lifecycle-phases-2-4`  
Date: 2026-09-22  
Env: localhost Vite (web). Native iOS/Android OS dialogs not exercised in this pass.  
**Production Supabase migration NOT applied** (safety gate).

## Automated tests

| Suite | Result |
|---|---|
| `installation-lifecycle.test.ts` | 6/6 pass |
| `permission-lifecycle-phases.test.ts` | 5/5 pass |
| `guest-location-discovery.test.ts` | 13/13 pass |
| `sociva-share.test.ts` | 4/4 pass |

## Browser E2E (localhost)

| Journey | Result | Notes |
|---|---|---|
| Fresh guest → discovery hero | PASS | Logo, “Your Community Marketplace”, Use my location / Select manually, no login wall |
| Manual Places → map confirm (Indiranagar) | PASS | Real label “Indira Nagar”, no Bangalore fallback |
| Single Confirm → finding → empty | PASS | “Nothing nearby yet”, Try another / Select manually / Explore categories / Invite |
| Explore categories (guest) | PASS | `/categories` with location header |
| Guest Home | PASS | Location “Indira Nagar”, Sign in available, no forced OTP |
| Guest Orders | PASS | Redirects to `/auth` |
| Guest cart + Almost There | PASS | Cart visible; checkout CTA → OTP “Almost There” with order intent |
| Auto OS notif after login (code) | PASS | `requestFullPermission` removed from auth/checkout; soft sheet marked instead |
| Permission Center wiring (code) | PASS | Profile card + Home banner + PostLogin sheet |

## Known gaps / follow-ups

1. **`app_installations` migration** exists in-repo only - apply after staging validation. Admin Permission Health shows “unavailable until migration applied” until then.
2. **WhatsApp OG on production** - `https://www.sociva.in/api/share/product|store/...` currently returns SPA HTML (OG not live). Code in `api/share/*` is ready; needs Vercel deploy of Edge functions.
3. **Native-only UX** - Permission Center / soft banners are native (`Capacitor.isNativePlatform()`); web correctly skips native permission UI.
4. **Discovery preview radius** uses marketplace cap RPC; per-seller `delivery_radius_km` is enforced in search/home SQL (`LEAST(..., delivery_radius_km)`). Transaction path still uses seller radius separately.
5. **iOS fresh install / push delivery / multi-device** require device builds - not covered in this web pass.

## Acceptance criterion status

Guest can open Sociva, set location (GPS or manual), browse without registering, and authenticate only when placing an order / protected actions - without silent Bangalore fallback or surprise notification OS dialogs. Existing `device_tokens` delivery pipeline untouched.
