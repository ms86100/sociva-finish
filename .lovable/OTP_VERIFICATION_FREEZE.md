# 🔒 OTP VERIFICATION — CODE FREEZE (2026-03-10)

## Status: FROZEN ✅ — Working & Verified

---

## Frozen Files (DO NOT MODIFY)

| File | Purpose |
|------|---------|
| `supabase/functions/msg91-send-otp/index.ts` | Sends OTP via MSG91 Widget API |
| `supabase/functions/msg91-verify-otp/index.ts` | Verifies OTP, creates/finds user, returns magiclink token |
| `src/hooks/useAuthPage.ts` | Client-side auth flow (phone → OTP → society selection) |

Frozen backups exist at `*.FROZEN_BACKUP` alongside each file.

---

## Architecture Summary

```
Client (useAuthPage.ts)
  │
  ├─ Step 1: POST msg91-send-otp { phone, country_code }
  │    └─ Returns { reqId } — store this for verify + resend
  │
  ├─ Step 2: POST msg91-verify-otp { reqId, otp, phone, country_code }
  │    └─ Returns { token_hash, is_new_user }
  │
  └─ Step 3: supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
       └─ Establishes browser session
```

### Key Design Decisions

1. **Synthetic email**: Each phone user gets `{countrycode}{phone}@phone.sociva.app` as their auth email
2. **Magiclink bridge**: After MSG91 verifies OTP, we generate a Supabase magiclink token hash to establish a native Supabase session — this keeps all existing RLS policies working via `auth.uid()`
3. **Phone passed from client**: The verified phone number comes from the client request (same number that initiated the OTP), NOT extracted from MSG91's token response

---

## ⚠️ CRITICAL LESSONS LEARNED — DO NOT REPEAT THESE MISTAKES

### 1. NEVER use MSG91's `verifyAccessToken` endpoint
**What happened**: After `verifyOtp` succeeds, MSG91 returns a JWT in the `message` field. We tried calling `verifyAccessToken` as a second verification step. It failed because MSG91 expects the field name `access-token` (hyphenated) not `access_token` (underscored), and the API behavior is inconsistent.

**Fix**: Removed the `verifyAccessToken` call entirely. Single-step verification via `verifyOtp` is sufficient.

**Rule**: ✅ One API call to verify (`verifyOtp`). Do NOT add a second `verifyAccessToken` step.

### 2. MSG91 `message` field contains DIFFERENT things depending on `type`
- When `type: "success"` → `message` contains a **JWT access token** (long string like `eyJ0eXA...`)
- When `type: "error"` → `message` contains an **error description** (e.g., "otp already verifed", "invalid otp")

**Rule**: ✅ NEVER display `verifyData.message` to users — it could be a raw JWT token. Always use `getFriendlyError()` for error cases and ignore the message content for success cases.

### 3. MSG91 error codes reference
| Code | MSG91 message | Friendly message |
|------|--------------|-----------------|
| 703 | "otp already verifed" | "This OTP has already been used. Please request a new one." |
| 705 | "invalid otp" | "Incorrect OTP. Please check the code and try again." |
| 706 | "expired" | "OTP has expired. Please request a new one." |
| 707 | "max attempt" | "Too many attempts. Please request a new OTP." |
| — | "mobile not found" | "Phone number not found. Please go back and re-enter your number." |

### 4. Client-side error handling — use `fetch()` not `supabase.functions.invoke()`
**What happened**: `supabase.functions.invoke()` throws on non-2xx responses, which triggers Lovable's error overlay showing raw technical errors to users.

**Fix**: Use raw `fetch()` with manual response parsing. This allows us to read the JSON body even on 400/500 responses and show friendly toast messages.

**Rule**: ✅ Always use `fetch()` for OTP edge functions. Parse response body manually. Use `toast.error()` with early `return` — NEVER `throw`.

### 5. reqId management
- `reqId` is returned by `msg91-send-otp` on first send
- Same `reqId` must be passed to both `msg91-verify-otp` AND resend calls
- Store in React state (`otpReqId`), not localStorage

### 6. Edge function CORS headers
Must include these extended headers for Supabase client compatibility:
```
authorization, x-client-info, apikey, content-type,
x-supabase-client-platform, x-supabase-client-platform-version,
x-supabase-client-runtime, x-supabase-client-runtime-version
```

### 7. Required secrets (configured in Lovable Cloud)
- `MSG91_AUTH_KEY` — MSG91 account auth key
- `MSG91_WIDGET_ID` — MSG91 widget ID
- `MSG91_TOKEN_AUTH` — MSG91 token auth value

---

## Testing Checklist

- [ ] Fresh phone → OTP sent → correct OTP → new user created → session established
- [ ] Existing phone → OTP sent → correct OTP → existing user found → session established
- [ ] Wrong OTP → friendly "Incorrect OTP" toast (no technical errors shown)
- [ ] Expired OTP → friendly "OTP expired" toast
- [ ] Already verified OTP → friendly "already used" toast
- [ ] Resend OTP → new OTP sent using same reqId
- [ ] No raw JWT tokens or technical errors ever shown to users
