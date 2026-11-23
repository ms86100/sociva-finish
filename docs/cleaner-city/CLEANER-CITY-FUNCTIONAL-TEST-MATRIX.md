# Cleaner City - Functional Test Matrix

**Audit:** CC-UX-PROD-20261110  
**Result vocabulary:** PASS | FAIL | BLOCKED | NOT TESTED  
**PASS requires evidence from this run.**

| ID | Area | Case | Expected | Actual | Status | Evidence |
|----|------|------|----------|--------|--------|----------|
| F01 | IA | Bottom nav Home/Find/My rides/Profile | Four tabs; Find active styling | Observed on Find + Home | PASS | Browser snapshot `#/cleaner-city/find`, `#/cleaner-city` |
| F02 | Find | Direction swap flips pickup/destination | Labels swap; search re-runs | Swap control flipped Manyata ↔ Greenfield | PASS | Click `cleaner-city-find-swap-direction`; snapshot |
| F03 | Find | Mockup sample matches render | Cards with request CTA | Arjun/Meera/Karan cards + Request seat | PASS | Mockup banner on; screenshot |
| F04 | Find | Missing pickup honesty | Distinct copy vs empty inventory | “Set your commute pins…” restored | PASS | Source + go-live test |
| F05 | Find | Empty inventory honesty | Empty state present | “No rides…” + sr-only legacy phrases | PASS | Find empty block + vitest |
| F06 | Match | Pre-request details route | `/cleaner-city/match` loads details | Route mounted in App.tsx; card opens details | PASS | Code + Home/Find wiring |
| F07 | Match card | Plate / stars / why / chips | Present on full card | Restored this run | PASS | MatchCard + phase0/hopr tests |
| F08 | Home | Greeting + Find/Offer CTAs | Mockup-aligned shell | Good evening Priya + CTAs + nearby | PASS | Browser snapshot mockup |
| F09 | Offer | Publish entry still RPC-backed | Publish seats flow reachable | Page loads; tabs/publish present | PARTIAL | Browser tab open earlier; no publish write this run → treat as UI-only **PASS shell**, write **NOT TESTED** |
| F09w | Offer | Publish write | Publication row created | Not executed | NOT TESTED | Needs host fixture |
| F10 | Booking | Guest request seat | RPC creates ride | Not executed (mockup toast path) | NOT TESTED | Dual account required |
| F11 | Booking | Host accept/decline | Status transitions | Not executed | NOT TESTED | |
| F12 | OTP | Guest generate + host start | Server OTP start | Not executed | NOT TESTED | |
| F13 | Lifecycle | Complete + rate | Server complete | Not executed | NOT TESTED | |
| F14 | Seats | Concurrent last-seat | Atomic reject of loser | Not re-run | NOT TESTED | Prior B3 docs only (not this run) |
| F15 | Safety | SOS honesty copy | Not a 112 dialer | Copy restored | PASS | Safety page string + tests |
| F16 | Safety | Live SOS fan-out | Contacts notified | Not executed | NOT TESTED | Safety: no blast |
| F17 | Call/Chat/Share | Quick action row | Visible on active ride | Component wired on RidePage | PARTIAL | Code PASS; live call **NOT TESTED** |
| F18 | Fuel | Server estimate + pay | Razorpay path | Not executed | NOT TESTED | No real money |
| F19 | Push | Accept/request notifications | Device delivery | Not executed | NOT TESTED | No device |
| F20 | Auth | Login/logout/session | Session works | Existing session assumed in browser | BLOCKED / partial | No fresh registration this run |
| F21 | RLS | Outsider cannot read peer ride | Deny | Not JWT-penetrated this run | NOT TESTED | Schema RLS on; penetration pending |
| F22 | My rides | Filters + cards | Upcoming/pending/hosting | Page restyled | PASS UI | Code; mockup list path |
| F23 | YourRidesBoard | Going / ensure host | Reachable | Component unmounted from pages | FAIL | Inventory agent + grep |
| F24 | Repeat last commute | Home CTA | Reachable | Hook unused by pages | FAIL | Inventory |
| F25 | Vitest contracts | `src/test/cleaner-city` | All green | 221/221 | PASS | Terminal EXIT:0 |
| F26 | Feature gate | `cleaner_city` active | Society-gated feature | Row present `is_active=true` | PASS | SQL |
| F27 | Meetup points | Admin pins exist | >0 for pilot | count=3 | PASS | SQL |
| F28 | Edge inventory | CC edges ACTIVE | OTP/alerts/fuel | Listed ACTIVE | PASS | list_edge_functions |

**Counts:** PASS 14 · FAIL 2 · BLOCKED/partial 2 · NOT TESTED 10 · PARTIAL noted in rows.
