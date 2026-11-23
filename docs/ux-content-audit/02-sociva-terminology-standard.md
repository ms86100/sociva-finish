# 02 - Sociva Terminology Standard

**Status:** Approved for Phase 8 remediation  
**Principle:** Say only what is necessary. Use familiar words. One concept, one name.

---

## 1. Writing rules

1. Page title: short and descriptive.
2. Section title: names the task or information.
3. Field label: names what to enter (do not rely on placeholder alone).
4. Button: names the action outcome (`Book Now`, not `Submit` unless submitting a form is the clearest word).
5. Supporting text: only when the label is not enough.
6. Help icon (`HelpCircle` + Tooltip/popover): for concepts that need explanation (e.g. fuel contribution). Prefer this over permanent paragraphs.
7. Do not repeat the same fact in heading, subtitle, banner, and button.
8. No marketing copy inside operational workflows.
9. Empty states: one short line + one next action.
10. Errors: specific and actionable; never raw API/PostgREST/RLS text.
11. Success: concise confirmation.
12. ASCII hyphen `-` only (no em dash or en dash).
13. Avoid unnecessary uppercase, exclamation marks, and vague buttons (`Go`, `Proceed`, `Action`, bare `Done`).

---

## 2. Role and entity glossary

| Approved term | Meaning | Where used | Do not use | Exceptions |
|---------------|---------|------------|------------|------------|
| Buyer | Person purchasing or browsing marketplace | Buyer UI, analytics labels | Consumer, Merchant counterpart | Legal "Consumer Protection" |
| Customer | Person who placed an order, from seller viewpoint | Seller order/earnings UI | Mixing with Buyer on same seller screen | - |
| Seller | Person or business selling | Seller and buyer UI for the person | Merchant, Vendor | - |
| Store | The shopfront / listing home | Cart, checkout, storefront | Calling the person "Store" | - |
| Resident | Society member using community features | Society, directory | User (in UI labels) | Code may say user_id |
| Host | Person offering seats in A Cleaner City | Cleaner City | Rider (for this role), Driver, Ride Creator | - |
| Guest | Person requesting a seat | Cleaner City | Passenger, Rider (for this role), Ride Seeker | Vehicle "seats" count OK |
| Neighbour | Generic other person in commute UX | Match cards, empty names | - | Fallback display name |
| Worker | Domestic/society workforce person | HelpHub / workforce | Guest | Distinct product |
| Admin | Platform or society administrator | Admin-only UI | Showing admin instructions to residents | - |

---

## 3. Marketplace transactions

| Approved term | Meaning | Where used | Do not use interchangeably | Exceptions |
|---------------|---------|------------|----------------------------|------------|
| Order | Cart checkout purchase | Cart, orders, payments | Booking, Enquiry for cart orders | - |
| Booking | Time-slotted service reservation | Book commerce mode | Order for bookings | - |
| Enquiry / Contact seller | Non-cart contact intent | Services / contact mode | Order | - |
| Order status | Where the order is in fulfilment | Order detail | Order Fulfilment as page title | "Fulfilled on {date}" OK |
| Payment History | Past payments | Wallet/history | Transaction History (prefer Payment History) | Admin finance tools may say transaction |
| Add Product | Create a listing | Seller products | Create Listing (OK as secondary) | - |
| Manage Stock | Inventory quantity | Seller | Manage Inventory | - |
| Sociva Credits | Platform credit balance | Credits screens | Vague "points" | Onboarding grant: exactly 500 |

---

## 4. A Cleaner City

| Approved term | Meaning | Where used | Do not use | Exceptions |
|---------------|---------|------------|------------|------------|
| A Cleaner City | Product name | Titles, entry cards, back links | sociva cleaner city, mixed Cleaner City alone in titles | Code path `/cleaner-city`; internal docs may say Green City |
| Ride | Shared commute unit | Nav, headers, actions | Mission, Quest, Run as primary | Trip share feature name may stay "Trip share" |
| Offer a ride | Host publishing seats | Offer flow | Publish journey config | - |
| Request a seat | Guest asking | Find/match | Initiate Booking | - |
| Seats available | Capacity | Offer/find | - | - |
| Request accepted | Host accepted guest | Status | - | - |
| Ride confirmed | Confirmed seat | Status | - | - |
| Fuel contribution | Guest share of petrol cost | Match, ride, settlement | Fare, taxi charge, shared cost (as primary), admin petrol price | Tooltip may say "based on distance and petrol price" |
| Pickup point | Start / home side pin | Setup, offer, find | Raw lat/lng | - |
| Destination / Office | End of commute | Setup, offer | Drop as primary when Office is clearer | Drop-off OK during live ride |
| Meeting point | Agreed wait location after confirm | Ride | Guest pickup pin as permanent label | - |
| Pickup code | 6-digit start code | Ride actions | OTP (in CC UI) | - |
| Route | Saved commute path | Route tab | Corridor as primary metaphor | Soften "corridor" in match reasons |
| Regular commute / Schedule | Recurring plan | Schedule | Autopilot as self-driving | "Automatic matching" OK if explained |
| My rides | List of active/past rides | Bottom nav / list | Missions, Your runs, Live quests | - |
| Find | Discover matches / offer switch | Bottom nav | Play | - |

---

## 5. Primary actions (cross-app)

| Situation | Prefer | Avoid |
|-----------|--------|-------|
| Authenticate | Sign In / Please Sign In | Authentication Required |
| Continue after info | Continue | Execute Action, Proceed |
| Send non-payment request | Send Request | Submit Request (OK on forms) |
| Book a slot | Book Now | Initiate Booking |
| Confirm destructive | Confirm {action} | OK alone |
| Empty list | Nothing here yet | No Records Found |
| Personal data | Personal Details | User Details |
| Contact fields | Contact Details | Contact Information |

---

## 6. Admin vs customer separation

- Customer UI: resident vocabulary only.
- Seller UI: seller operations vocabulary.
- Host/Guest UI: Cleaner City vocabulary above.
- Admin instructions, RLS, feature flags, queue names, BUILD_IDs, FCM tokens: admin or DEV only.
- Never fix a permission leak with CSS hide; use route guards / role checks.

---

## 7. Help icon standard

Use existing `Tooltip` + `HelpCircle` (or established title tooltip where Tooltip is impractical on maps).

Example:

**Fuel contribution** [help]

> Your share is calculated from route distance and the current petrol price. This is not a fare.
