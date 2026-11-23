# Cleaner City - Phase 1 Device Dogfood Results

**Date:** 2026-11-01

No supervised iOS or Android session was run. Nothing below is a PASS.

| Check | Status | Evidence |
|-------|--------|----------|
| Create and publish a commute | NOT RUN | No device |
| Find and request | NOT RUN | No device |
| Host accept and reject | NOT RUN | No device |
| Ride OTP lifecycle | NOT RUN | No device |
| Cancel and waitlist notification | NOT RUN | No device |
| SOS in-app flow | NOT RUN | No device; also refused as an unsolicited alert |
| Open Google Maps and return | NOT RUN | No device |
| Lock phone and reopen | NOT RUN | No device |
| Background tracking claim | STATIC ONLY | Ride copy says background tracking is not guaranteed (`CleanerCityRidePage.tsx`). Not verified on a device |
| Book / commerce | NOT RUN | No browser or device pass this gate |
| Orders | NOT RUN | |
| Contact | NOT RUN | |
| Delivery tracking | NOT RUN | |
| Existing notification channels | NOT RUN | |
| Auth and society membership | NOT RUN | Setup screen was seen earlier in the product session; that is not this gate's regression pass |

### Work-email screen (prior session, not a full OTP pass)

A resident reached Step 2, domain check said `support@sociva.in` was approved, and Send returned the Resend setup error. That matches the 502 / 403 log in the acceptance results. Inbox delivery was **not** observed.

### Typecheck

`npx tsc --noEmit -p tsconfig.json` exit 0. This does not exercise devices.
