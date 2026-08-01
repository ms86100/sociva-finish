# Android Play Console — Data Safety & Permissions

Guidance for declaring Sociva (`app.sociva.community`) accurately. Inspect a release AAB merged manifest before final submit:

```bash
# After building release
bundletool dump manifest --bundle=android/app/build/outputs/bundle/release/app-release.aab
# or from an installed APK:
adb shell dumpsys package app.sociva.community | findstr permission
```

## Expected data types (Data Safety form)

| Data type | Collected? | Shared? | Purpose | Notes |
|-----------|------------|---------|---------|-------|
| **Precise location** | Yes | Yes (buyer sees live track during delivery) | App functionality | Signup geofence + **active delivery tracking** |
| **Background location** | Yes | Yes (to buyer for that delivery) | App functionality | Sellers / delivery partners only; disclosure + runtime permission required |
| **Name, phone, email** | Yes | Limited (sellers / society admin) | Account, delivery | |
| **User IDs** | Yes | No (except processors) | Account | Supabase auth |
| **Device / other IDs** | Yes | With FCM | App functionality | Push tokens |
| **Photos** | Yes | No (storage) | App functionality | Listings, payment proofs |
| **Purchase history** | Yes | No | App functionality | Orders |
| **Messages** | Yes | No | App functionality | Buyer–seller chat |
| **Payment info** | Ephemeral / via Razorpay | Razorpay | Payments | UPI IDs for sellers; card data via Razorpay — do not claim Sociva stores cards |

## Permissions (merged from Capacitor plugins)

Typical merges (confirm with dump):

- `INTERNET`
- `CAMERA` / media read (listings)
- `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`
- `ACCESS_BACKGROUND_LOCATION` (Transistorsoft background geolocation)
- `POST_NOTIFICATIONS` (Android 13+)
- `FOREGROUND_SERVICE` / location FGS types (plugin)
- `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED` (as declared by plugins)

Declare **all** dangerous permissions used; do not claim “no location” if background delivery tracking ships.

## Privacy Policy URL

Use the live policy that discloses background delivery tracking:

`https://www.sociva.in/#/privacy-policy`  
(in-app: `/#/privacy-policy`)

If CMS/DB overrides privacy markdown, ensure that copy also mentions background location.

## Background location Play questions

- **Is location used in the background?** Yes — during active seller/partner deliveries only.
- **Prominent disclosure:** In-app AlertDialog before enabling tracking (`SellerGPSTracker`, delivery partner dashboard).
- **Video:** Play often requires a demo video showing the disclosure → permission → delivery tracking UI.

## Push / notifications

Declare that the app may send push for order updates; permission requested at runtime.

## Checklist before submit

- [ ] Data Safety matches table above
- [ ] Privacy Policy live + accurate
- [ ] Background location declaration + video uploaded
- [ ] Account deletion path documented
- [ ] Content rating completed
- [ ] Target audience / store listing from `STORE_METADATA.md`
