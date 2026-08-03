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

## Meta caveat

Free-form text only works inside the 24-hour customer care window (or Meta test numbers). Outside that window you need an approved message template.
