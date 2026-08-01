# Sociva - Production Deployment Guide

## Prerequisites

Before deploying to app stores, ensure you have:

### For iOS (App Store)
- Mac with Xcode 15+ installed
- Apple Developer Account ($99/year)
- App Store Connect access
- Firebase project (for FCM push notifications)

### For Android (Google Play)
- Android Studio installed
- Google Play Developer Account ($25 one-time)
- Firebase project for push notifications
- Keystore for signing the app

---

## Step 1: Firebase Cloud Messaging (FCM) Setup

Push notifications for both iOS and Android are handled through Firebase Cloud Messaging (FCM). The backend uses the FCM HTTP v1 API.

### 1.1 Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project" or select existing project
3. Enter project name (e.g., "Sociva")
4. Enable Google Analytics (optional)
5. Click "Create project"

### 1.2 Add iOS App to Firebase

1. In Firebase Console, click "Add app" → iOS
2. Enter iOS bundle ID: `app.sociva.community`
3. Enter app nickname: "Sociva iOS"
4. Download `GoogleService-Info.plist`
5. Place the file in `ios/App/App/` folder

### 1.3 Add Android App to Firebase

1. In Firebase Console, click "Add app" → Android
2. Enter package name: `app.sociva.community`
3. Enter app nickname: "Sociva Android"
4. Get SHA-1 fingerprint: `keytool -list -v -keystore your-release-key.keystore`
5. Download `google-services.json`
6. Place the file in `android/app/` folder

### 1.4 Configure APNs for iOS

1. Go to Apple Developer Portal → Certificates, Identifiers & Profiles
2. Go to Keys → Create a new key
3. Enable "Apple Push Notifications service (APNs)"
4. Download the `.p8` key file (save it securely!)
5. Note the Key ID and Team ID
6. In Firebase Console → Project Settings → Cloud Messaging
7. Under "Apple app configuration", upload the APNs key
8. Enter Key ID and Team ID

### 1.5 Generate Service Account Key

1. In Firebase Console → Project Settings → Service accounts
2. Click "Generate new private key"
3. Download the JSON file
4. This file is already configured as `FIREBASE_SERVICE_ACCOUNT` secret in Lovable Cloud

---

## Step 2: Prepare the Codebase

### 2.1 Build for Production

The Capacitor config automatically switches between development and production modes based on the `CAPACITOR_ENV` environment variable. No file swapping is needed.

```bash
export CAPACITOR_ENV=production
```

### 2.2 Update Deep Linking Configuration

#### iOS (Apple App Site Association)
Edit `public/.well-known/apple-app-site-association`:
- Replace `TEAM_ID` with your Apple Developer Team ID (found in Apple Developer Portal → Membership)

#### Android (Asset Links)
Edit `public/.well-known/assetlinks.json`:
- Replace `SHA256_FINGERPRINT_PLACEHOLDER` with your app's signing certificate fingerprint
- Get fingerprint: `keytool -list -v -keystore your-release-key.keystore -alias your-alias`
- Copy the SHA-256 fingerprint (format: `AA:BB:CC:...`)

---

## Step 3: Build the Web App

```bash
npm install
npm run build
ls -la dist/
```

---

## Step 4: Sync with Native Projects

```bash
npx cap sync
# This copies the dist/ folder to:
# - ios/App/App/public/
# - android/app/src/main/assets/public/
```

---

## Step 5: Build for iOS

### 5.1 Open in Xcode
```bash
npx cap open ios
```

### 5.2 Add GoogleService-Info.plist
1. Drag `GoogleService-Info.plist` into Xcode project navigator
2. Ensure "Copy items if needed" is checked
3. Add to target: App

### 5.3 Configure Signing
1. Select the project in navigator
2. Go to "Signing & Capabilities"
3. Select your Team
4. Ensure bundle ID matches: `app.sociva.community`

### 5.4 Add Required Capabilities
Click "+ Capability" and add:
- **Push Notifications** - Required for FCM
- **Associated Domains** - Add: `applinks:www.sociva.in`
- **Background Modes** - Check "Remote notifications"

### 5.5 Build Archive
1. Select "Any iOS Device" as target
2. Product → Archive
3. Once complete, click "Distribute App"
4. Choose "App Store Connect"

### 5.6 App Store Submission
1. Log into App Store Connect
2. Create new app listing
3. Fill in metadata, screenshots, privacy policy URL
4. Submit for review

---

## Step 6: Build for Android

### 6.1 Open in Android Studio
```bash
npx cap open android
```

### 6.2 Verify google-services.json
Ensure `android/app/google-services.json` exists and is correct.

### 6.3 Generate Signed APK/Bundle
1. Build → Generate Signed Bundle/APK
2. Choose "Android App Bundle" for Play Store
3. Create or select your keystore
4. Select "release" build variant
5. Build

### 6.4 Google Play Submission
1. Log into Google Play Console
2. Create new app
3. Upload AAB file
4. Complete store listing, content rating, pricing
5. Submit for review

---

## App Store Requirements Checklist

### ✅ Already Implemented
- [x] Privacy Policy page (`/#/privacy-policy`)
- [x] Terms of Service page (`/#/terms`)
- [x] Account Deletion feature (Profile → Delete Account)
- [x] Demo account for reviewers (`demo@sociva.app` / `DemoReview2026!`)
- [x] Deep linking support (Universal Links / App Links)
- [x] Push notification backend (FCM HTTP v1)
- [x] Push notification client (Capacitor)
- [x] Offline support banner
- [x] Error boundary for crash handling
- [x] Branding: "Sociva"

### 📋 Required Screenshots (You need to create)
- iPhone 6.7" (1290 x 2796 px)
- iPhone 6.5" (1242 x 2688 px)
- iPhone 5.5" (1242 x 2208 px)
- iPad Pro 12.9" (2048 x 2732 px)
- Android Phone (1080 x 1920 px minimum)
- Android Tablet (1200 x 1920 px minimum)

### 📋 Required App Store Metadata
- App name: Sociva
- Subtitle: Community Services Marketplace
- Keywords: community, marketplace, services, food delivery, tutoring, home services, rentals, local, neighbors
- Description (4000 chars max) - See STORE_METADATA.md
- What's New (for updates)
- Support URL
- Marketing URL (optional)

---

## Environment Configuration

### Production Environment Variables
The app uses these environment variables (already configured):
- `VITE_SUPABASE_URL` - Backend API URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` - Public API key

### Backend Secrets (Lovable Cloud)
These secrets are already configured:
- `FIREBASE_SERVICE_ACCOUNT` - FCM authentication
- `RAZORPAY_KEY_ID` - Payment processing
- `RAZORPAY_KEY_SECRET` - Payment processing

### Razorpay Configuration
Configure in Admin Panel → Settings → API Configuration:
- Razorpay Key ID (live key for production)
- Razorpay Key Secret

---

## Testing Before Submission

### Test Checklist
- [ ] App launches without crash
- [ ] Login/signup works
- [ ] Browse sellers and products
- [ ] Add to cart and checkout
- [ ] UPI payment flow (with test mode)
- [ ] Push notifications received on iOS
- [ ] Push notifications received on Android
- [ ] Offline banner appears when no network
- [ ] Deep links open correct pages (test: `sociva://orders`)
- [ ] Account deletion works
- [ ] Demo account can access app

---

## Common Issues & Solutions

### iOS: App rejected for not working
- Ensure `CAPACITOR_ENV=production` is set before `npx cap sync`
- Verify `dist/` folder is synced

### Android: Signing issues
- Use the same keystore for all builds
- Never lose your keystore or you can't update the app

### Push notifications not working (iOS)
- Verify APNs key is uploaded to Firebase
- Check `GoogleService-Info.plist` is in correct location
- Ensure Push Notifications capability is added in Xcode
- Ensure Background Modes → Remote notifications is enabled

### Push notifications not working (Android)
- Check `google-services.json` is in `android/app/`
- Verify SHA-1/SHA-256 fingerprint matches in Firebase
- Ensure device token is being registered (check console logs)

### Deep links not working
- Verify AASA/assetlinks.json are accessible via HTTPS
- Test: `curl https://www.sociva.in/.well-known/apple-app-site-association`
- Check Team ID and SHA256 fingerprints are correct
- Wait up to 24 hours for Apple/Google to cache files
- For testing, use: `npx uri-scheme open "sociva://orders" --ios`

### FCM errors in edge function logs
- Verify `FIREBASE_SERVICE_ACCOUNT` secret is set correctly
- Ensure the JSON is valid and complete
- Check Firebase project has Cloud Messaging API enabled

---

## App Icon Requirements

| Platform | Size | Notes |
|----------|------|-------|
| iOS App Store | 1024x1024 | Required for App Store Connect |
| Android Play Store | 512x512 | ✅ Already exists |
| Feature Graphic (Android) | 1024x500 | Required for Play Store |

**Tip:** Use [App Icon Generator](https://www.appicon.co/) to generate all required sizes from a single 1024x1024 image.
