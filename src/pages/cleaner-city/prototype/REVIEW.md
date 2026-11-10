# Cleaner City UX prototype - review pack

## Access
HashRouter URL:

`/#/cleaner-city/prototype`

Local example: `http://127.0.0.1:5188/#/cleaner-city/prototype`

- No login required
- Banner: Design preview · mock data only
- Reset demo in the top bar clears sessionStorage (v2)

## Lovable ease polish (this iteration)
Borrowing clarity from the Lovable “rove” reference **without** rebranding or dropping features:

- Home / Discover header: **Verify office email** + **+ Offer a ride**
- Verify modal: building icon, Work email field, Send code, demo disclaimer
- Discover sub-nav: Find a ride · My rides · Host dashboard + How it works
- Match cards: Best route overlap, avatar, Community/Office badges, vertical pickup→drop, Along your way, Details expand, Message host
- Home: **Your profile is verified** trust card
- Still mobile 4-tab: Home · Discover · My Rides · Profile

## Demo script (must pass)
1. Complete onboarding as Priya (or Reset + finish if needed)
2. Home → Search rides / Discover Find → Request **Arjun** (Best overlap)
3. Switch **Viewing as → Arjun** → Discover Offer → **Accept request**
4. Switch to Priya → open ride → set meeting point → Create pickup code
5. Switch to Arjun → enter `482916` → Start trip → Complete
6. Both sides: rate / fuel
7. Profile → switch Find/Offer without re-onboarding
8. Profile → Feature preservation matrix

## New IA
Home · Discover (Find|Offer) · My Rides · Profile

## Before vs after (brief)
| Before | After (mock) |
| --- | --- |
| Thin Find list | Search card + rich community ride cards |
| Thin Offer card | Full publish form + seat-request inbox |
| Separate Find/Offer/Setup menus | One Discover mode switch |
| Host/guest feel like modules | Perspective switcher + one profile |

## Hard to accommodate
- Admin dispute resolution UI
- Vehicle document admin approval
- Desktop sidebar Messages/Payments/Trust as top-level (mapped into ride chat, fuel settle, Profile safety)

## Approval gate
Do **not** implement into production `/cleaner-city/*` until:

`APPROVED - IMPLEMENT THIS DESIGN`
