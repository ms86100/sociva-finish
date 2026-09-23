# Guest discovery - Phase 2 test matrix

Fill Pass/Fail during QA on a build from `fix/guest-location-discovery`.  
**Do not** treat this as done until each row is marked.

Automated already: `src/test/guest-location-discovery.test.ts` (unit/source wiring).

## A. Guest happy path

| # | Case | Pass/Fail | Notes |
|---|------|-----------|-------|
| A1 | Fresh install / clear storage → location explanation before OS prompt | | |
| A2 | Allow location → Home shows nearby catalog without account | | |
| A3 | Deny location → Select manually → map confirm → Home | | |
| A4 | Browse search / category / product / seller storefront as guest | | |
| A5 | Add to cart → OTP → item restored (or cart contains item) | | |
| A6 | Enquire → OTP → sheet resumes on product | | |
| A7 | Book → OTP → booking sheet resumes | | |
| A8 | Contact seller → OTP → contact resumes | | |
| A9 | Header **Sign in** + **Available near you** visible for guest | | |
| A10 | Bottom nav **Sign in**; Orders/Cart → auth with return | | |

## B. Authenticated regression (must match today’s behavior)

| # | Case | Pass/Fail | Notes |
|---|------|-----------|-------|
| B1 | Buyer with society: Home → search → cart → checkout | | |
| B2 | Buyer without society: still forced to `/profile/edit` | | |
| B3 | Orders list + order detail | | |
| B4 | Logout → guest location/browse path | | |
| B5 | Login returning user → lands Home (or pending return) | | |

## C. Seller / admin

| # | Case | Pass/Fail | Notes |
|---|------|-----------|-------|
| C1 | Seller dashboard / products / settings | | |
| C2 | Seller orders inbox | | |
| C3 | Admin critical smoke (command center or products review) | | |

## D. Security (anon must fail writes)

| # | Case | Pass/Fail | Notes |
|---|------|-----------|-------|
| D1 | Anon insert `cart_items` fails | | |
| D2 | Anon create order / booking / enquiry RPC fails | | |
| D3 | Anon profile / seller_profiles update fails | | |
| D4 | Anon payment / wallet / credits write fails | | |

## E. Platform

| # | Case | Pass/Fail | Notes |
|---|------|-----------|-------|
| E1 | iOS When In Use prompt copy mentions near-you discovery | | |
| E2 | Buyer browse never requests Always location | | |
| E3 | Android guest browse still works (no iOS-only break) | | |

## Sign-off

- Tester:  
- Build / commit:  
- Date:  
- Ready for deploy approval? Yes / No  
