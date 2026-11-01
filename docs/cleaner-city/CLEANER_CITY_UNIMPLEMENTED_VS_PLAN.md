# Cleaner City - Plan vs shipped (honest gap list)

Updated after the OTP/UI regression audit (2026-11-01).

## Fixed in this audit pass

- Opaque edge-function errors on work-email OTP (now surfaces real domain / Resend messages)
- Setup flow rearranged into 3 steps with domain pre-check, approved company list, and domain request
- Hub checklist when not ready
- Domain check + request RPCs; OTP edge function redeployed (v3)

## Still not fully implemented vs product-owner plan / must-builds

| Item | Status | Notes |
|------|--------|-------|
| One-tap "Repeat last commute" | Missing | Autopilot drafts exist; no dedicated rebook-last CTA |
| True road-network polyline overlap | Partial | Still detour/extra-meters proxy; hard filter on |
| Society meetup points seeded for Greenfield | Missing | Table + picker exist; admin must seed POIs |
| Background location for active rides (true native continuous) | Partial | Permission helper + foreground poll + resume; not full background service |
| SOS dial / SMS to non-Sociva emergency contacts | Partial | In-app notify when `notify_user_id` set; phone field is display-only |
| Masked phone call between host/guest | Missing | Quick phrases only |
| Fuel Razorpay / wallet settlement | Deferred | Legal gate; estimate + ledger only |
| Vehicle document file upload + admin KYC | Missing | Metadata only |
| Full free-form chat | Deferred | Intentional |
| Guaranteed cancel backup SLA | Partial | Waitlist + suggest replacements; not a guarantee |
| Custom Resend From domain | Ops gap | `resend_api_key` present; `resend_from_email` still missing - Resend test From may reject many recipients |

## Approved domains currently in prod

airbus.com, google.com, infosys.com, tcs.com, wipro.com

Any other company email must be requested (now in Setup UI) then approved in Admin Cleaner City.
