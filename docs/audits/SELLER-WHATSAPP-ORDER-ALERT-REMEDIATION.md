# Sociva Seller Order Alerts + WhatsApp Lifecycle Remediation

**Date:** 2026-11-15  
**Project:** Sociva (`kkzkuyhgdvyecmxtmkpy`)  
**Active WhatsApp provider:** Evolution Go (live, readiness gates passed)

---

## 1. Root cause analysis

### A. Android media playback controls on incoming order bell

**Status: IMPLEMENTED (code). DEVICE VERIFICATION PENDING.**

| Finding | Detail |
|---|---|
| Native `MediaSession` / `MediaStyle` / `MediaPlayer` | **Not present** in Sociva Android order-alert code |
| Actual ring paths | FCM `OrderAlertMessagingService` (channel sound) + in-app `playGateBell` HTMLAudioElement + Web Audio loop in `useNewOrderAlert` |
| Root cause | Chromium WebView publishes a system **MediaSession** when HTML/`AudioContext` plays `gate_bell.mp3`, so Android shows media play/pause controls |
| Secondary | `LiveDeliveryService` used `CATEGORY_TRANSPORT` (OEM may style like transit/media) |

### B. Missing WhatsApp Accept / Reject buttons

**Status: PARTIALLY FIXED (backend). HANDSET VERIFICATION PENDING.**

| Finding | Detail |
|---|---|
| Provider | Evolution Go (not Meta interactive for seller cards) |
| Send path | `seller-new-order-whatsapp` + `nudge-seller-accept-whatsapp` via `/send/carousel` |
| UX bug | **Plain text was sent first** with copy "Tap Accept or Reject", then a separate carousel. Sellers often only noticed the text message (no buttons) |
| Auth bug | Button taps from `@lid` chats passed LID digits as `p_phone` into `seller_whatsapp_decide_order`, which requires the seller mobile last-10 match - causing `Not authorized` / `applied: false` |
| Lifecycle gap | Compact webhook replied "Updated" only and **did not** send the next-step interactive card (START PREPARING / MARK READY / ...) |

Evidence (order `#758CD0`):

- 01:38:48 carousel claimed `button_ok=true`
- 01:38:53 order already `accepted` (likely app)
- 01:39:37 WhatsApp accept tap logged with `applied: false`

---

## 2. Architecture (single source of truth)

```
Order row (orders + category_status_transitions)
        |
        +--> seller_advance_order (app + WhatsApp RPCs)
        |
        +--> notification_queue --> FCM / LocalNotifications
        |
        +--> seller-new-order-whatsapp / nudge --> Evolution carousel
        |
        +--> receive-evolution-go-webhook
                 --> seller_whatsapp_decide_order / apply_step / apply_otp
                 --> seller_advance_order (same RPC as app)
```

No parallel WhatsApp-only order state machine.

---

## 3. Changes implemented (file paths)

### Android native alert

| File | Change |
|---|---|
| `android/.../OrderAlertRinger.java` | Ringtone + `USAGE_NOTIFICATION_RINGTONE`, order-id concurrent set |
| `android/.../OrderAlertRingerPlugin.java` | Capacitor bridge `start` / `stop` / `stopAll` |
| `android/.../MainActivity.java` | Register plugin |
| `android/.../OrderAlertMessagingService.java` | Terminal FCM cancels alert; unique PendingIntent; `CATEGORY_ALARM` |
| `android/.../LiveDeliveryService.kt` | `CATEGORY_TRANSPORT` -> `CATEGORY_STATUS` |
| `src/plugins/order-alert-ringer/index.ts` | JS bridge |
| `src/lib/play-gate-bell.ts` | Android skips HTML audio; clears MediaSession |
| `src/hooks/useNewOrderAlert.ts` | Native ringer; per-order stop; concurrent start |
| `src/lib/order-alert-ack.ts` | Ack sources + native stop |

### WhatsApp

| File | Change |
|---|---|
| `supabase/functions/seller-new-order-whatsapp/index.ts` | Interactive-first; text only on failure; ACCEPT/REJECT ORDER labels |
| `supabase/functions/receive-evolution-go-webhook/index.ts` | LID->phone auth; next-step cards; idempotency; ack RPC |
| `supabase/functions/nudge-seller-accept-whatsapp/index.ts` | Matching button labels |
| `supabase/functions/_shared/whatsapp-seller-decision.ts` | Step/decision display labels |
| `src/components/notifications/WhatsAppUpdatesCta.tsx` | Seller order-management copy |

### Database

| File | Change |
|---|---|
| `supabase/migrations/20261115120000_seller_order_alerts.sql` | `seller_order_alerts` + `ack_seller_order_alert` |
| Applied on production | **YES** (`kkzkuyhgdvyecmxtmkpy`) |

### Tests

| File | Result |
|---|---|
| `src/test/order-alert-ack.test.ts` | AUTOMATED TEST PASSED |
| `src/test/whatsapp-seller-decision-labels.test.ts` | AUTOMATED TEST PASSED |

---

## 4. Verification matrix

| Criterion | Status |
|---|---|
| Bell without media playback UI | IMPLEMENTED - needs Android rebuild + handset |
| Bell stops on app accept/reject/open | IMPLEMENTED - needs handset |
| Bell stops on WhatsApp accept/reject | IMPLEMENTED (FCM `is_terminal` + native stop) - needs handset |
| Multi-order independent ringing | IMPLEMENTED - needs handset |
| Actual WhatsApp Accept/Reject buttons | IMPLEMENTED (interactive-first) - **STAGING/HANDSET PENDING** |
| Full lifecycle buttons after accept | IMPLEMENTED in webhook - **deploy + handset pending** |
| LID auth for button taps | IMPLEMENTED - **deploy pending** |
| Buyer sync via same `seller_advance_order` | Already production path - unchanged |
| Edge function deploy | **DEPLOYED** - webhook v29, seller-new-order-whatsapp v8, nudge v9 |
| Android APK / Codemagic build | **NOT RUN** - native ringer needs a new Android build |
| Production WhatsApp handset proof | **NOT RUN** - do not mark PRODUCTION VERIFIED |

---

## 5. External dependencies / remaining limitations

1. **Android:** Rebuild + install APK/AAB so `OrderAlertRinger` ships to devices.
2. **Edge functions:** Deploy `receive-evolution-go-webhook`, `seller-new-order-whatsapp`, `nudge-seller-accept-whatsapp` to production.
3. **Evolution Go:** Unofficial WhatsApp Web path; carousel can still fail to render on some clients - text ACCEPT/REJECT fallback remains.
4. **Meta Cloud API interactive templates:** Not used for seller Accept/Reject while Evolution is active. If provider switches to Meta, approved quick-reply templates are required outside the 24h window.
5. **Seller opt-in:** Sellers must Send Hi / enable WhatsApp prefs; optional disable remains via notification preferences.

---

## 6. Recommended handset test plan (do not skip)

1. Rebuild Android with native ringer; place test order with app killed / locked / background / foreground.
2. Confirm shade has **no** media play/pause for the bell.
3. Accept in-app and confirm ring stops for that order only when a second order is ringing.
4. Place order; confirm WhatsApp shows interactive **ACCEPT ORDER** / **REJECT ORDER** (not text-only).
5. Accept on WhatsApp; confirm DB status, buyer UI, and next card **START PREPARING**.
6. Continue MARK READY / COMPLETE (or delivery OTP) and confirm buyer parity.
7. Duplicate tap / already-accepted / wrong number negative cases.
