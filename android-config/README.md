# Android Firebase Configuration

Place your `google-services.json` file in this directory.

## How to get it

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Click the **Android app** (package: `app.sociva.community`)
4. Download `google-services.json`
5. Place it here as `android-config/google-services.json`

## What happens during build

Codemagic automatically copies this file to `android/app/google-services.json` during the Android build step. Without it, Firebase services (push notifications, analytics, etc.) will not work.

## Important

- Do **not** commit this file if your repo is public (it contains API keys)
- For private repos, committing it is fine and simplifies CI/CD
