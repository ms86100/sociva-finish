# 🚨 PUSH NOTIFICATION CODE — FROZEN 🚨
## Date: 2026-03-07
## Status: WORKING & VERIFIED ON PHYSICAL iOS DEVICE

### ⚠️ DO NOT MODIFY THESE FILES ⚠️

The following files are **FROZEN** and must NOT be changed:

1. `src/hooks/usePushNotifications.ts`
2. `src/components/notifications/PushNotificationProvider.tsx`
3. `src/components/notifications/EnableNotificationsBanner.tsx`
4. `src/contexts/PushNotificationContext.tsx`
5. `src/lib/capacitor.ts`

### Backup copies (`.FROZEN_BACKUP`) exist alongside each file.

### Architecture (Dual-Plugin, Listener Gate)
- `@capacitor/push-notifications` → permissions + raw APNs token
- `@capacitor-community/fcm` → FCM token on iOS
- Listener gate ensures listeners are ready before `register()` is called
- `claim_device_token` RPC for atomic DB storage
- Build ID: `2026-03-07-DUAL-PLUGIN-V2-LISTENER-GATE`

### Verified
- APNs delivery confirmed (HTTP 200, apns-id received)
- Token captured and stored in `device_tokens` table
- End-to-end push delivery working on physical iOS device
