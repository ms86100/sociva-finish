# Concrete E2E - Biryani and Kebab (immediate COD)

**Date:** 2026-09-22  
**Env:** `http://localhost:3000` (Vite) + production Supabase read/write for store open + order  
**Branch:** `fix/guest-location-discovery`  
**Buyer:** QA OTP phone `9876543201` (code `1234`)  
**Store:** Biryani and Kebab (`95d88378-b998-4f9b-b3f6-ff788aa2b81f`)  
**Order:** `14f9ebe7-be0d-46f5-b7c3-ac5f8142758a`

## Prep (so it is NOT pre-order)

| Change | Result |
|--------|--------|
| `seller_profiles.is_available = true`, hours `00:00-23:59` | Store open now |
| `products.accepts_preorders = false` on **Biryani** + **Kebab** | Immediate checkout (no required schedule) |

Products: Kebab `0a542d6a-…`, Biryani `463aceda-…` - both `add_to_cart`, ₹99.

## Steps run in browser

1. Guest `#/discover-location` → location near Shriram Greenfield  
2. Guest `#/seller/95d88378-…` → menu shows **Kebab** + **Biryani**, ADD (no Pre-order badge)  
3. Guest ADD → auth gate (“Sign in to add items to cart”)  
4. OTP login → Home  
5. Add **Kebab** + **Biryani** → cart **2 items · ₹198**  
6. Cart: COD + Delivery, schedule optional (“Schedule for later?”)  
7. Place Order → Confirm → **Order Placed!**

## Pass/Fail

| Case | Result |
|------|--------|
| Guest can open store without login | PASS |
| Guest ADD forces OTP | PASS |
| Both items add to cart (immediate, not pre-order) | PASS |
| Place COD order without required schedule | PASS |
| Order detail shows Kebab + Biryani ₹198 COD | PASS |

## Notes

- Web guest home `/` still redirects to marketing landing; use `#/discover-location`, `#/search`, `#/seller/:id`, `#/product/:id` for guest browse on web (native uses shell allow-list).  
- Pending cart restore after OTP did not auto-add in this run; re-add after login worked.  
