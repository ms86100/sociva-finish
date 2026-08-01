# Android Firebase Configuration

FCM push (and Crashlytics) require a real `google-services.json` from Firebase Console.  
**Do not invent credentials** — download the file from Google.

## Exact user actions

1. Open [Firebase Console](https://console.firebase.google.com) → select (or create) the Sociva project.
2. Project settings → **Your apps** → add Android app if missing:
   - Package name: **`app.sociva.community`** (must match `applicationId`)
3. Download **`google-services.json`**.
4. Place the file in **both** of these locations (CI copies from the first; local Gradle reads the second):

   ```
   android-config/google-services.json
   android/app/google-services.json
   ```

5. Add the app’s **SHA-1** and **SHA-256** (debug + release keystores) in Firebase → Project settings → Your Android app → SHA certificate fingerprints.  
   Get them with:

   ```bash
   keytool -list -v -keystore path/to/sociva-release.keystore -alias sociva
   ```

6. Rebuild:

   ```bash
   npx cap sync android
   cd android && ./gradlew :app:assembleDebug
   ```

## Example / template

See `google-services.json.example` for the expected shape. Replace it with the **real** download — the example will not enable FCM.

## What the build does

- `android/app/build.gradle` applies the `com.google.gms.google-services` plugin **only if** `android/app/google-services.json` exists and is non-empty.
- Without the file, the Android app still builds; push registration no-ops / fails gracefully in JS.
- Codemagic copies `android-config/google-services.json` → `android/app/google-services.json` when present.

## Security

- Do **not** commit production `google-services.json` to a public repo.
- Prefer Codemagic / CI secrets, or keep the file local / in a private secure store.
