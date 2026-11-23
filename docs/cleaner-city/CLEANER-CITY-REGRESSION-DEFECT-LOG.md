# Cleaner City - Regression Defect Log

**Audit:** CC-UX-PROD-20261110

| ID | Severity | Title | Root cause | Fix | Retest |
|----|----------|-------|------------|-----|--------|
| D01 | HIGH | Vitest suite 21 failures after UX redesign | Hub testids moved Find→Home; honesty copy removed; MatchCard lost plate/why/stars | Restored product strings/UI; re-homed tests; MatchCard enrichment | PASS - 221/221 |
| D02 | MEDIUM | Seats a11y read as “2 seat s left” | JSX split text nodes around plural `s` | Template literal `${seats} seat…` | PASS - browser a11y name “2 seats” |
| D03 | HIGH | Find lacked from/to switch | Redesign omitted swap control | ArrowUpDown control toggles `to_office`/`to_home` | PASS - browser click |
| D04 | HIGH | OTP guest copy dropped “Show this code to your host” | Mockup restyle removed line | Restored above OTP digits | PASS - ride-safety-otp test |
| D05 | HIGH | Safety honesty “112 dialer” wording drifted | Copy said “112 call” | Restored “not a 112 dialer” | PASS - phase1 remediation |
| D06 | MEDIUM | Find active ride CTA lost pickup-code deep link | Button said “Open active ride” only | Status-aware “Open ride for pickup code” | PASS - hopr/corridor tests |
| D07 | MEDIUM | Emergency soft-gate tip missing on Find | Redesign removed tip | Tip + `hasVerifiedEmergency` restored | PASS - hopr-parity |
| D08 | MEDIUM | Match card lost plate/stars/why/chips | Compact mockup restyle | Restored enrichment UI | PASS - phase0/hopr/match-card |
| D09 | MEDIUM | Route/Vehicle honesty strings missing | Copy drift | Pin/private office + bike cap + admin verification later | PASS - unit4/unit5/phase1 |
| D10 | HIGH | `CleanerCityYourRidesBoard` unreachable | Redesign My rides page does not import board | **OPEN** - needs product decision + restore or replace | FAIL remaining |
| D11 | HIGH | Dual host/guest live lifecycle not executed | No second auth session this run | **OPEN** | NOT TESTED |
| D12 | HIGH | Push/device/background not tested | Browser-only audit | **OPEN** | NOT TESTED |

## Remaining open work

- D10: Re-mount Going/Not Going / ensure-host UX or document deliberate removal with alternate path.  
- D11: Execute CERT-prefixed dual fixture journey end-to-end.  
- D12: Android build + FCM closed-app cases.
