# Cleaner City pilot dogfood checklist

Use this before inviting a pilot society. Meeting pins are **self-serve** (Uber/Hopr style) - do not wait on admin lat/lng seeds.

## Setup

- [ ] Work email OTP on approved domain
- [ ] Office pin + home gate on `/cleaner-city/route` (also setup step 3)
- [ ] Morning **and** evening Google road chosen (explicit tap, not silent)
- [ ] Weekly schedule leave/return times
- [ ] Host: vehicle added

## Matching and booking

- [ ] Find shows usual-road chip when saved
- [ ] Offer reuses usual road for that direction
- [ ] Request → confirm → Active ride on Find
- [ ] Meeting pin: GPS / guest pickup / drag map / confirm (no admin list required)

## Live ride

- [ ] Map shows published polyline when available + live H/G markers
- [ ] Chat send/receive works (no rides RLS recursion)
- [ ] Call: either relay succeeds or honest "not available - use chat" (never fake success)
- [ ] SOS: in-app notify; if SMS fails, toast says SMS failed clearly; Call 112 still offered
- [ ] OTP / start / complete / rate / fuel share empty state copy

## Platform

- [ ] Android: commute FG tracking while ride active
- [ ] iOS: foreground location only (no background locate)
- [ ] Feature flag `cleaner_city` on for pilot society only
- [ ] No primary CTA that only toasts "not configured"
