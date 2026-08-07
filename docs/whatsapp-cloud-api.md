# WhatsApp Cloud API (Sociva)

## Status
- Migration applied: `whatsapp_messages` + credential keys
- Edge Functions deployed: `send-whatsapp`, `receive-whatsapp-webhook`
- Admin UI: **Admin → Developer Tools → Send WhatsApp Test**
- Credentials UI: **Admin → Credentials → WhatsApp**
- Client abstraction: `src/services/notificationService.ts`

## Secrets required (provide these to finish phone delivery)

Set via Dashboard **Edge Functions → Secrets** or CLI:

```bash
supabase secrets set WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_VERIFY_TOKEN=... --project-ref kkzkuyhgdvyecmxtmkpy
```

Optional: `WHATSAPP_BUSINESS_ACCOUNT_ID`

Or paste the same values in Admin → Credentials → WhatsApp (DB takes precedence).

## Webhook URL (Meta Developer Console)

```
https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/receive-whatsapp-webhook
```

- Callback URL: above
- Verify token: same as `WHATSAPP_VERIFY_TOKEN`
- Subscribe to `messages`

## Test

1. Deploy frontend (Vercel) so Admin Developer Tools is live, **or** call the function with an admin JWT.
2. Admin → Developer Tools → phone `91XXXXXXXXXX` → message `Hello from Sociva` → Send.

## Meta caveats (production number +91 99029 20804)

1. **Free-form text** only delivers inside the **24-hour customer service window** (user messaged you, or an approved template opened the conversation). Meta may accept the API call (`wamid…`) and still fail delivery asynchronously — this is why “hello im from sociva” to `8448802907` looked successful but never arrived.
2. **Sample templates** (`hello_world`, Jasper Market) return `#131058` on production phone numbers — they are Public Test Number only.
3. **Custom Sociva templates** were submitted (PENDING → wait for Meta approval): `sociva_hello`, `sociva_booking_confirmed`, `sociva_booking_cancelled`, `sociva_booking_reminder`, `sociva_order_update`, `sociva_new_order_seller`, `sociva_payment_update`, `sociva_refund_update`, `sociva_store_status`.
4. Portfolio messaging limit is **`TIER_250`** until Business Verification / scaling.
5. **Auth OTP template** `sociva_otp_login` could **not** be created (2026-08-03): Meta `OAuthException` code `10` / subcode `2388185` — WABA lacks permission to create AUTHENTICATION templates (eligibility / Business Verification). Keep **MSG91** for login OTP until an auth template is creatable and **APPROVED**.

### Unblock a handset right now

Have the recipient WhatsApp **any message** to **+91 99029 20804**, then resend free-form text — or wait until `sociva_hello` is **APPROVED** and send that template.

### In-app opt-in CTA (user-initiated “Hi”)

- UI: `WhatsAppUpdatesCta` on active order detail (buyer/seller) and **Profile → Notification Settings**.
- Deep link: `https://wa.me/919902920804?text=Hi%20Sociva%2C%20register%20me%20for%20order%20and%20delivery%20updates.`
- On tap, the app sets `notification_preferences.whatsapp = true` and `whatsapp_opted_in_at = now()`.
- **Meta rules:** Opening WhatsApp + the user **sending** the message opens the ~24h customer service window. A business-side “hello register me” **template is NOT required** for this opt-in (it is user-initiated). Until custom `sociva_*` templates are **APPROVED**, outbound status WhatsApp only works inside that window (or fails over to free-form after a failed template attempt). Once templates are approved, status messages can be sent even without a recent “hi”.

## Phase 2 architecture

- `notification_queue` → `process-notification-queue` still delivers in-app + push.
- Same processor also calls `_shared/whatsapp-notify.ts` for eligible order/booking/refund/seller events (respects `notification_preferences.whatsapp`).
- Templates preferred via `sendWhatsAppTemplateOrText`; falls back to free-form when templates are pending / session open.

### Wired WhatsApp events (2026-08-03 gap close)

| Event | Audience | Trigger | WA template |
|---|---|---|---|
| Provider assigned / changed | Buyer | `manage-delivery` assign + order `assigned` | `sociva_order_update` |
| On the way / arrived / service started / completed | Buyer | `fn_enqueue_order_status_notification` (+ arrived flows seeded, `in_progress` notify enabled) | `sociva_order_update` / booking templates by status |
| Review reminder | Buyer | `fn_send_review_nudges` → `review_nudge` | `sociva_order_update` |
| Seller daily summary | Seller | `daily-seller-summary` cron | `sociva_payment_update` |
| Settlement pending / eligible / paid | Seller | `seller_settlements` + `payment_settlements` triggers | `sociva_payment_update` |
| Low rating alert (≤2★) | Seller | `fn_review_after_insert` | `sociva_order_update` |
| License / store / product status | Seller | `admin-notifications.ts` enqueue | `sociva_store_status` |
| Marketing / campaigns | Opt-in only | `send-campaign` queues `promotion` when **promotions + whatsapp** prefs | `sociva_order_update` (gated by `allow_whatsapp_marketing`) |

Marketing WhatsApp never sends unless both `notification_preferences.promotions` and `whatsapp` are true and the queue payload sets `allow_whatsapp_marketing: true`. Settings UI copy documents this.
