# Android Payment QA Checklist

Manual device matrix for Sociva Capacitor Android (physical devices preferred).  
Run after `npm run build && npx cap sync android` with a **signed** debug/release install.

## Setup

- [ ] Device online (cellular + Wi‑Fi separately once)
- [ ] At least one seller with `upi_verification_status === valid`
- [ ] Payment mode toggles available: UPI deep link + Razorpay (admin)
- [ ] GPay / PhonePe / Paytm installed for UPI cases

## UPI deep link (`UpiDeepLinkCheckout`)

- [ ] Open checkout → Pay via UPI sheet opens
- [ ] Tap **Google Pay** → GPay opens with correct amount / UPI / note
- [ ] Complete or cancel in GPay → return to app → confirm step shown
- [ ] Repeat for **PhonePe** and **Paytm**
- [ ] Generic `upi://` chooser appears if using QR / system handler
- [ ] Submit screenshot + UTR → claim submitted (order **not** falsely marked paid)
- [ ] Blocked path when seller UPI not verified
- [ ] Hardware **back** closes sheet (or confirm step) without killing app mid-flow

## Razorpay (WebView Checkout.js)

- [ ] Razorpay overlay opens inside app (not blank white screen)
- [ ] Card payment success → webhook / order status updates
- [ ] UPI inside Razorpay → external UPI app → return → success or honest failure
- [ ] Dismiss / back mid-checkout does not double-charge or leave stuck “processing”
- [ ] Safe-area / keyboard does not hide Pay button on small screens

## COD

- [ ] COD-only fulfillment places order without opening UPI/Razorpay

## Regression

- [ ] Airplane mode at checkout → blocked with clear messaging (no fake placed order)
- [ ] Resume from background after UPI does not wipe cart incorrectly
- [ ] `android:queries` present — UPI package discovery works on Android 11+

## Sign-off

| Device | OS | UPI | Razorpay | Tester | Date |
|--------|----|-----|----------|--------|------|
|        |    |     |          |        |      |

**Go criteria:** All critical UPI + Razorpay rows pass on ≥2 Android 13/14 devices.
