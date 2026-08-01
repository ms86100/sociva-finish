# App Store & Play Store Screenshots Guide

Generate professional screenshots for your Sociva app store listings.

---

## Required Screenshots

### Apple App Store (iOS)

| Device | Resolution | Required |
|--------|-----------|----------|
| iPhone 6.7" (15 Pro Max) | 1290 × 2796 | ✅ Yes |
| iPhone 6.5" (14 Plus) | 1284 × 2778 | ✅ Yes |
| iPhone 5.5" (8 Plus) | 1242 × 2208 | Optional |
| iPad Pro 12.9" | 2048 × 2732 | If supporting iPad |

**Minimum:** 3 screenshots per device size. **Maximum:** 10.

### Google Play Store (Android)

| Type | Resolution | Required |
|------|-----------|----------|
| Phone | 1080 × 1920 (min) | ✅ Yes (2–8) |
| 7" Tablet | 1200 × 1920 | Optional |
| 10" Tablet | 1600 × 2560 | Optional |

---

## Recommended Screenshots (in order)

1. **Home / Browse** — Show the community marketplace with categories
2. **Seller Store** — A seller's page with products/services
3. **Order Flow** — Cart or checkout screen
4. **Order Tracking** — Active order with status updates
5. **Seller Dashboard** — Earnings and order management
6. **Chat** — In-app messaging between buyer and seller
7. **Categories** — Grid of available service categories
8. **Profile** — User profile with community info

---

## How to Capture Screenshots

### Option 1: Xcode Simulator (iOS)

```bash
# Build and run on simulator
export CAPACITOR_ENV=production
npm run build
npx cap sync ios
npx cap open ios
```

1. In Xcode, select the target device (e.g., iPhone 15 Pro Max)
2. Run the app (⌘R)
3. Log in with the demo account: `demo@sociva.app` / `DemoReview2026!`
4. Navigate to each screen
5. Capture: **⌘S** (saves to Desktop) or **File → Save Screen**

### Option 2: Android Studio Emulator

```bash
export CAPACITOR_ENV=production
npm run build
npx cap sync android
npx cap open android
```

1. Create an emulator with Pixel 7 Pro (1080 × 2400)
2. Run the app
3. Log in with the demo account
4. Navigate to each screen
5. Capture: Click the camera icon in the emulator toolbar

### Option 3: Physical Device

1. Install the app via TestFlight (iOS) or internal testing (Android)
2. Take screenshots natively:
   - **iOS:** Side button + Volume Up
   - **Android:** Power + Volume Down

---

## Screenshot Enhancement Tips

### Adding Device Frames & Text

Use one of these tools to add device mockups and marketing text:

| Tool | Free? | URL |
|------|-------|-----|
| **Screenshots Pro** | Freemium | [screenshots.pro](https://screenshots.pro) |
| **AppMockUp** | Free | [app-mockup.com](https://app-mockup.com) |
| **Previewed** | Freemium | [previewed.app](https://previewed.app) |
| **Figma** | Free | Use device frame templates |

### Marketing Text Suggestions

| Screenshot | Headline |
|-----------|----------|
| Home | "Your Community Marketplace" |
| Seller Store | "Shop From Your Neighbors" |
| Order Flow | "Order in Seconds" |
| Tracking | "Track Every Order Live" |
| Dashboard | "Sell to Your Community" |
| Chat | "Chat Directly with Sellers" |
| Categories | "Services at Your Doorstep" |
| Profile | "One Community, One App" |

---

## Feature Graphic (Android Only)

- **Size:** 1024 × 500 px
- **Location:** Already at `public/feature-graphic.png`
- Update if branding changes

---

## Pre-Upload Checklist

- [ ] Screenshots show real app content (use demo account data)
- [ ] No debug overlays, developer tools, or status bar clutter
- [ ] Text is legible at thumbnail size
- [ ] All required device sizes covered
- [ ] Feature graphic updated (Android)
- [ ] Screenshots match current app version
- [ ] No placeholder or lorem ipsum text visible

---

## Demo Account for Screenshots

Use the pre-configured demo account to capture consistent screenshots:

- **Email:** `demo@sociva.app`
- **Password:** `DemoReview2026!`

This account has sample data pre-loaded for realistic screenshots.
