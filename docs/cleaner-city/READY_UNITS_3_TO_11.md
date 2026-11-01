# A Cleaner City - ready status (Units 3-11)

Production project: `kkzkuyhgdvyecmxtmkpy` (Sociva). Greenfield Tower H remains the pilot society with `cleaner_city` enabled.

## Routes

| Path | Purpose |
|------|---------|
| `/cleaner-city` | Hub |
| `/cleaner-city/setup` | Profile + work email OTP |
| `/cleaner-city/schedule` | Weekly templates + overrides + pause |
| `/cleaner-city/vehicle` | Car/bike + docs metadata |
| `/cleaner-city/route` | Office + pickup pins + route preview |
| `/cleaner-city/offer` | Publish seats |
| `/cleaner-city/find` | Match, request, accept, OTP start, complete |

## Backend (applied)

- Unit 3 schedules (pause > override > template)
- Unit 4 vehicles, docs, publish/cancel
- Unit 5 office pins, route geometry, detour helpers
- Unit 6 `cleaner_city_find_matches` (5B route/detour, not same-office-only)
- Unit 7 request / respond / cancel with seat holds
- Unit 8 OTP generate / start / complete
- Units 10-11 ratings + cost-share ledger (no payout settlement)

## Tests

`npx vitest run src/test/cleaner-city` - contract + routing helpers (33 passing at ship).

## Known external gates

- Resend `RESEND_API_KEY` still required for work-email OTP delivery (edge returns `email_provider_missing` without it)
- Cost-share settlement / Razorpay remains legally gated
- Live tracking / SOS (Unit 9) and admin analytics (Unit 12) not shipped in this pass
