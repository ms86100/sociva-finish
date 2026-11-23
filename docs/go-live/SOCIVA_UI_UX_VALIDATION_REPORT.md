# Sociva Stage 2 UI / UX Validation Report

| Field | Value |
| --- | --- |
| Date | 2026-11-23 |
| App under review | `https://sociva-integration.vercel.app` |
| Backend | Staging banner confirms `wwuanzbusxoyzixuprxs.supabase.co` |
| Session observed | Existing staging QA user "Apple Review" (not Stage2 seed user) |
| Viewports | Mobile (~390, default browser), desktop metrics override 1440×900 |

## Environment confirmation

Yellow staging banner present:

`STAGING BUILD · wwuanzbusxoyzixuprxs.supabase.co · not production`

No production host observed in the UI shell.

## Surfaces inspected

| Surface | URL | Observation |
| --- | --- | --- |
| Home / marketplace | `#/` | Loads; search, categories, cart chip, bottom nav intact |
| Account / profile | `#/profile` | Profile header, My Society, Seller Dashboard, Sign Out present |
| Society hub | `#/society` | Feature tiles render (Visitors, Authorized Persons, HelpHub, Finances, Maintenance, Disputes) |
| Visitors | `#/visitors` | Add visitor CTA, Today/Upcoming/History tabs, export, expected visitor card |

## Viewport notes

| Width | Result |
| --- | --- |
| ~390 (mobile shell) | Society hub and visitors usable; bottom nav remains |
| 1440 (metrics override) | App still functional; primary layout remains mobile-first shell (expected for current product) |
| 1024 tablet | Not separately screenshotted this pass; Guard Kiosk tablet walkthrough remains a manual follow-up with Stage2 guard account |

## Defects found / fixed in Stage 2 code

| Issue | Severity | Action |
| --- | --- | --- |
| Features RPC missing `society_configurable` could hide Society entry | P0 | Fixed on staging RPC + frontend types |
| Society entry visibility brittle without configurable flag | P0 | `useSocietyEntryVisible` hardened |
| Visitor empty state copy vague | Low | Copy clarified on Visitor Management page |

## Defects observed (non-blocking / pre-existing)

| Issue | Severity | Notes |
| --- | --- | --- |
| Society hub feature set depends on logged-in user's society package | Info | Apple Review society shows subset; Stage2 Society A has pilot (26 enabled) via RPC |
| Desktop is still mobile-first chrome | Info | Not redesigned (Stage2 rule: no unnecessary redesign) |
| Guard Kiosk tablet UX not exercised with Stage2 guard login in browser | Medium | Covered at API level; device UI pending |

## Critical workflow UI status

| Workflow | UI status |
| --- | --- |
| Open Society hub | Works on staging build |
| Open Visitors / Add visitor | Controls present |
| Home marketplace browse | Works |
| Account navigation | Works |
| Infinite load / blank society hub | Not observed after settle |
| Dead "My Society" link | Navigates to `#/society` |

## Accessibility / polish

- Staging banner is high-contrast and clear about non-production.
- Visitor empty-state copy now states next action (create pass / history explanation).
- No new card-heavy redesign introduced.

## Conclusion

UI shell on staging is operational for society entry and visitor management. Critical Stage2 UX blockers tied to features RPC / society visibility were fixed in code + staging DB. Remaining UI gap is a full persona walkthrough logged in as Stage2 seed users (especially Guard Kiosk at tablet width) after deploying the local frontend diffs if the live integration build does not yet include them.
