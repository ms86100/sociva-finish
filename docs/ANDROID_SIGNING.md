# Android release signing & AAB

## Local signing (optional)

1. Create a keystore (once):

```bash
keytool -genkey -v -keystore sociva-release.keystore -alias sociva -keyalg RSA -keysize 2048 -validity 10000
```

2. Copy `android/keystore.properties.example` → `android/keystore.properties` and fill passwords / paths.  
   **Do not commit** `keystore.properties` or the `.keystore` file.

3. Build a signed App Bundle:

```bash
npm run build
npx cap sync android
cd android
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

## Codemagic

CI injects signing from `CM_KEYSTORE` env when configured (`codemagic.yaml`). Prefer Play App Signing for production.

## SHA-256 for App Links + Firebase

```bash
keytool -list -v -keystore sociva-release.keystore -alias sociva
```

- Paste SHA-256 into `public/.well-known/assetlinks.json` (replace `TODO_REPLACE_SHA256`) and deploy to `www.sociva.in`.
- Add SHA-1 / SHA-256 in Firebase Console for the Android app.
- If using Play App Signing, also add the **App signing** certificate fingerprint from Play Console.

## Versioning

Aligned with `STORE_METADATA.md`:

| Field | Value |
|-------|-------|
| `package.json` version | `2.0.0` |
| `versionName` | `2.0.0` |
| `versionCode` | `2` (monotonic; bump every Play upload) |
