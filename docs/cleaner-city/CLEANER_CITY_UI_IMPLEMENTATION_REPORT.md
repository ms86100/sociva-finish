# Cleaner City - UI implementation report

This pass did not redraw every screen. It connected the home screen to real rows and fixed the Repeat last commute failure mode.

## Files changed in this pass

| File | Change |
| --- | --- |
| `src/hooks/queries/useCleanerCity.ts` | Repeat RPC retries once after 1.5s when PostgREST reports a schema-cache miss |
| `src/pages/cleaner-city/CleanerCityPage.tsx` | Plain-language repeat error. Impact card shows completed-ride count only |
| `docs/cleaner-city/CLEANER_CITY_COMPLETE_PRODUCT_GAP_AUDIT.md` | Evidence inventory |
| `docs/cleaner-city/CLEANER_CITY_PRODUCT_CLOSURE_ROADMAP.md` | P0-P3 and gates |
| `docs/cleaner-city/CLEANER_CITY_GAMIFIED_UX_STRATEGY.md` | Quest rules and what is not awarded |
| `docs/cleaner-city/CLEANER_CITY_COMPLETE_UI_DESIGN_SYSTEM.md` | Tokens taken from the existing cards |
| `docs/cleaner-city/CLEANER_CITY_UI_IMPLEMENTATION_REPORT.md` | This file |
| `docs/cleaner-city/CLEANER_CITY_FUNCTIONAL_REGRESSION_REPORT.md` | What was and was not run |
| `docs/cleaner-city/CLEANER_CITY_FINAL_PRODUCT_READINESS.md` | No-go |

## Screens

| Screen | What the resident sees now |
| --- | --- |
| Home | Quest path, completed-ride count, tomorrow, repeat. Repeat no longer shows the raw schema-cache sentence on the first failure after a retry |
| Other commute screens | Unchanged in this pass, except earlier guidance that already sends office save to the pickup section, pickup save to the schedule, a new vehicle to Offer, publish to home, and a ride request to the ride |

## Backend

No new migration was applied. Production already had `cleaner_city_repeat_last_commute()`. `NOTIFY pgrst, 'reload schema'` was sent so the API can see it.

Chat, fuel, badges, five stops, and city opt-in stay in repo files `20261102240000`, `20261102250000`, and `20261102260000`. They are not in the live database. The UI that calls them will fail until those files are applied on purpose.

## Known limits

- The quest XP number is a label, not a balance.
- Emissions are hidden on purpose.
- City marketplace, chat, fuel transfer, and stop 3-5 are visible in the app and not operational in production.
- iOS does not share location when the app is closed.
