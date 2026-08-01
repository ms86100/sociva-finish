# Pre-Submission Checklist

**Bundle ID:** `app.sociva.community`

All code work is complete. Follow these steps to submit to app stores.

---

## ✅ Already Done (In Lovable)

- [x] Push notification backend (FCM HTTP v1)
- [x] `FIREBASE_SERVICE_ACCOUNT` secret configured
- [x] Deep linking handler (`sociva://` custom scheme)
- [x] App icons (1024x1024 iOS, 512x512 Android)
- [x] Feature graphic (1024x500)
- [x] Privacy Policy & Terms pages
- [x] Account deletion feature
- [x] Safe area CSS for notch devices
- [x] Production build optimizations (minify, tree-shake, console strip)
- [x] Environment-aware Capacitor config (single file)

---

## 🔧 External Setup Required

### 1. Export & Build Locally

```bash
# After exporting to GitHub
git clone <your-repo-url>
cd <project-folder>
npm install

# Set production mode for Capacitor
export CAPACITOR_ENV=production

npx cap add ios
npx cap add android
npm run build
npx cap sync
```

---

### 2. Firebase Console

Download platform config files from your Firebase project:

| Platform | File | Destination |
|----------|------|-------------|
| iOS | `GoogleService-Info.plist` | `ios/App/App/` |
| Android | `google-services.json` | `android/app/` |

---

### 3. Apple Developer Portal

| Step | Action | Where to Find |
|------|--------|---------------|
| 1 | Get **Team ID** | [Membership page](https://developer.apple.com/account) → Team ID |
| 2 | Create **APNs Key** | Certificates → Keys → Create Key → Enable APNs |
| 3 | Upload APNs Key to Firebase | Firebase Console → Project Settings → Cloud Messaging → Apple app configuration |
| 4 | Update AASA file | Replace `TEAM_ID` in `public/.well-known/apple-app-site-association` |

**In Xcode:**
- [ ] Set Team in Signing & Capabilities
- [ ] Add capability: **Push Notifications**
- [ ] Add capability: **Associated Domains** → `applinks:www.sociva.in`
- [ ] Add capability: **Background Modes** → Remote notifications

---

### 4. Android Signing

| Step | Action |
|------|--------|
| 1 | Create release keystore (if you don't have one) |
| 2 | Get SHA-256 fingerprint |
| 3 | Update assetlinks.json |

**Commands:**

```bash
# Create keystore (first time only)
keytool -genkey -v -keystore sociva-release.keystore -alias sociva -keyalg RSA -keysize 2048 -validity 10000

# Get SHA-256 fingerprint
keytool -list -v -keystore sociva-release.keystore -alias sociva
```

Copy the SHA-256 fingerprint and replace `SHA256_FINGERPRINT_PLACEHOLDER` in:
`public/.well-known/assetlinks.json`

---

### 5. Build & Submit

**iOS:**
```bash
npx cap open ios
# In Xcode: Product → Archive → Distribute App → App Store Connect
```

**Android:**
```bash
npx cap open android
# In Android Studio: Build → Generate Signed Bundle/APK → Android App Bundle
```

---

## 📱 Test Before Submitting

- [ ] App launches without crash
- [ ] Login works
- [ ] Push notification received on device
- [ ] Tapping notification opens correct screen
- [ ] Deep link opens app (`sociva://orders`)

---

## 📋 Store Listing Assets Ready

| Asset | Location |
|-------|----------|
| iOS App Icon (1024x1024) | `public/app-icon-1024x1024.png` |
| Android Icon (512x512) | `public/android-chrome-512x512.png` |
| Feature Graphic (1024x500) | `public/feature-graphic.png` |
| Store Description | `STORE_METADATA.md` |

---

**⚠️ Keep your keystore safe!** If you lose it, you cannot update your Android app.
