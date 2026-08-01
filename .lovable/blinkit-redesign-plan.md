# Blinkit UI Redesign Plan

## Design System Analysis (from screenshots)

### Color Palette (Dark Mode — Blinkit)
- Background: ~#1a1a1a (deep charcoal, not pure black)
- Card background: ~#2a2a2a (slightly lighter)
- Search bar: ~#3a3a3a (rounded, full-width)
- ADD button: green border (#4CAF50), green fill when active
- Quantity stepper: solid green bg (#4CAF50) with white text
- Discount text: green (#4CAF50)
- MRP strikethrough: gray
- Delivery time icon: yellow/amber clock
- Heart icon: gray outline, blue/purple fill when active
- "View cart" floating bar: green gradient pill with product thumbnail
- Veg badge: green square with dot / Non-veg: red triangle
- Price per unit: small gray text
- Star ratings: yellow stars
- Category cards: dark rounded rect with product image, white text below
- Section headers: bold white, left-aligned
- Bottom nav: dark bg, white icons, active = filled

### Light Mode (Blinkit — to implement)
- Background: white/light gray
- Cards: white with subtle border
- Same green ADD buttons
- Same layout patterns

### Key UI Patterns

#### Header
- "Sociva in" (small text)
- "X minutes" (large bold)
- "HOME - [Address]" with dropdown
- Right: wallet icon + profile icon
- Below: rounded search bar with mic icon

#### Bottom Navigation
- Home | Order Again | Categories | Print | [external link]
- Center "Categories" has grid icon, slightly elevated
- Active tab: filled icon + label

#### Category Grid (Categories tab)
- Section headers: "Grocery & Kitchen", "Snacks & Drinks"
- 4-column grid
- Dark rounded cards with product images
- White text label below

#### Category Detail (Bottom sheet or full page)
- Left sidebar: vertical scroll of sub-categories with circular thumbnails
- Active sub-category: green highlight/border
- Right: 2-col product grid
- Top: filters bar (Filters, Sort, Price, Brand) — horizontal scroll
- Optional: category hero banner at top

#### Product Cards (in grid)
- Image takes ~60% height
- Heart icon top-right
- ADD button overlapping bottom of image (green border, white/transparent bg)
- "2 options" text below ADD when applicable
- Below image: weight/variant badges (gray pills)
- Product name (2 lines max)
- Star rating + count
- Delivery time (clock icon + "X MINS")
- Discount % in green
- Price bold, MRP strikethrough
- Price per unit (small gray)
- "See more like this" link at bottom

#### Product Detail (Full screen)
- Full-width image carousel with dot indicators
- Top overlay: back (chevron down), heart, search, share icons
- Below image: delivery time badge, product name, weight, price + MRP + discount
- "View product details" expandable
- When expanded: 24/7 Support + Fast Delivery icons, Highlights, Info sections
- "Select Unit" with variant cards (discount header, weight, price, per-unit)
- Brand link: logo + "Explore all products"
- Similar products horizontal scroll
- Bottom sticky: price summary left + "Add to cart" green button right
- "View cart" floating pill when items in cart

#### Favourites (Bottom sheet)
- 3-column grid
- Heart icon filled (blue)
- Quantity badge (red circle "x2") when multiple
- Same card layout as product cards
- "View cart" floating pill at bottom

#### Search
- Rounded search bar with back arrow, clear (x), mic icon
- Autocomplete suggestions: thumbnail + text, bold matching
- Promoted result card: image + "Cook in minutes" type CTA
- Below suggestions: filter pills (Filters, Sort, Non-veg, Veg, star)
- 3-column product grid results

#### Checkout/Cart
- Header: back arrow + "Checkout" + "Share" button
- Delivery time card: clock icon + "Delivery in X minutes" + "Shipment of X item"
- Item rows: thumbnail, name, variant, "Move to wishlist", price (MRP strikethrough), quantity stepper
- "You might also like" section: 3-col horizontal scroll
- Bottom: delivery address bar + payment method + green "Place Order" button with total

#### Profile
- "Your account" header with phone number
- Birthday promo card
- Quick action cards: Money, Support, Payments (3-col)
- App Update row
- Appearance toggle (Dark)
- "Hide sensitive items" toggle
- "YOUR INFORMATION" section: Your orders, Wishlist, Bookmarked recipes, Prescriptions

#### Your Orders
- "Your failed order" alert banner at top
- Order cards: green checkmark, "Arrived in X minutes", price, date
- Product thumbnails
- "Rate order" or "Reorder" CTA
- "Order placed by" info when shared

#### Order Summary
- Header: "Order summary" + arrival time + "Download Invoice"
- Delete icon top-right
- Items list with thumbnail, name, quantity, price
- "Rate now" prompt
- Bill details: MRP, Handling, Convenience, Delivery, Total
- Order details: ID (copyable), Payment method, Delivery address, Placed date
- "Need help?" section

## Implementation Phases

### Phase 1: Design System (light theme + token updates)
### Phase 2: Header + Search
### Phase 3: Home + Categories page
### Phase 4: Product cards + Product detail
### Phase 5: Cart + Checkout
### Phase 6: Orders + Profile
### Phase 7: Favourites + Order Again
