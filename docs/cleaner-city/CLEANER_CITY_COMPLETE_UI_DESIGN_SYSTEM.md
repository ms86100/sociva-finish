# Cleaner City - UI design system

Taken from the current Sociva commute cards, not a new brand.

## Tokens in use

| Token | Value | Where |
| --- | --- | --- |
| Commute green | `#0D3327` | Entry card and home hero |
| Leaf | `#A3C9A8` | Titles on the dark hero |
| Radius | 26px hero, 16px (`rounded-2xl`) sections | Entry card, home, journey |
| Type | Existing app font, extrabold titles, 11px uppercase labels | Home and journey |
| Buttons | `src/components/ui/button.tsx` | Every form |
| Inputs | `src/components/ui/input.tsx` | Every form |
| Toasts | `sonner` | Errors. Success should also leave a notice on the next screen |
| Tabs | Sociva bottom nav | Home, Book, Contact, Orders, Account. Cleaner City does not add a second tab bar |
| Motion | `active:scale-[0.99]` on the entry card | No extra animation library was added |

Primary buttons, borders, and muted text stay on the app theme (`bg-card`, `text-muted-foreground`, `border-border`) so the inner pages match the rest of Sociva.

## Screen map

| Screen | Route | Primary action |
| --- | --- | --- |
| Home | `/cleaner-city` | The highlighted quest, or Repeat last commute |
| Setup | `/cleaner-city/setup` | Save profile, then send the work-email code |
| Schedule | `/cleaner-city/schedule` | Save the day, then continue to vehicle or find |
| Office and pickup | `/cleaner-city/route` | Save office, then pickup, then schedule |
| Vehicle | `/cleaner-city/vehicle` | Save, then offer |
| Offer | `/cleaner-city/offer` | Publish, then home |
| Find | `/cleaner-city/find` | Search, then the ride |
| Ride | `/cleaner-city/ride/:id` | The status action: accept, OTP, complete, or SOS |
| Chat | `/cleaner-city/chat` | Send, only after the chat tables exist |
| Circles | `/cleaner-city/circles` | Create or join |
| Safety | `/cleaner-city/safety` | Add a contact, then verify |
| Share | `/cleaner-city/share/:token` | Read-only live share |
| Admin | Admin Cleaner City tab | Domains, meetup points, disputes |

## Rules

- One primary button per section.
- After a successful save, open the next screen or scroll to the next section. A toast alone is not the guide.
- Empty states name the missing thing and the page that fixes it.
- Do not show a city, chat, fuel, or five-stop success state when the server returns "function not found".
- SOS stays a direct button. It is not inside the quest card.
- Touch targets stay on the existing button sizes.
- Honour `prefers-reduced-motion` by not adding looping animation. The quest card does not animate.
- Dark hero text is white or `#A3C9A8` on `#0D3327`. Body text on cards uses `text-foreground`.

## Not built as separate components

`CommuteJourney` is the progress component. Match rows, ride actions, and circle cards still live in their pages. New wrapper components were not added, so the pages do not fork the button and card styles they already share.
