#!/bin/bash
# Installs the new splash screen images into the native Android & iOS projects.
# Run from the project root after `git pull`.

set -e

echo "📱 Installing splash screen assets..."

# Android
if [ -d "android/app/src/main/res" ]; then
  cp android-splash/splash.png android/app/src/main/res/drawable/splash.png
  cp android-splash/splash.png android/app/src/main/res/drawable-land-mdpi/splash.png 2>/dev/null || true
  cp android-splash/splash.png android/app/src/main/res/drawable-land-hdpi/splash.png 2>/dev/null || true
  cp android-splash/splash.png android/app/src/main/res/drawable-land-xhdpi/splash.png 2>/dev/null || true
  cp android-splash/splash.png android/app/src/main/res/drawable-land-xxhdpi/splash.png 2>/dev/null || true
  cp android-splash/splash.png android/app/src/main/res/drawable-land-xxxhdpi/splash.png 2>/dev/null || true
  cp android-splash/splash_mdpi.png android/app/src/main/res/drawable-port-mdpi/splash.png 2>/dev/null || true
  cp android-splash/splash_hdpi.png android/app/src/main/res/drawable-port-hdpi/splash.png 2>/dev/null || true
  cp android-splash/splash_xhdpi.png android/app/src/main/res/drawable-port-xhdpi/splash.png 2>/dev/null || true
  cp android-splash/splash_xxhdpi.png android/app/src/main/res/drawable-port-xxhdpi/splash.png 2>/dev/null || true
  cp android-splash/splash_xxxhdpi.png android/app/src/main/res/drawable-port-xxxhdpi/splash.png 2>/dev/null || true
  echo "  ✅ Android splash images installed"
else
  echo "  ⚠️  android/ directory not found — run 'npx cap add android' first"
fi

# iOS
if [ -d "ios/App/App/Assets.xcassets/Splash.imageset" ]; then
  cp ios-splash/splash.png ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png 2>/dev/null || \
  cp ios-splash/splash.png ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png 2>/dev/null || \
  cp ios-splash/splash.png "ios/App/App/Assets.xcassets/Splash.imageset/splash.png"
  echo "  ✅ iOS splash image installed"
else
  echo "  ⚠️  iOS Splash.imageset not found — run 'npx cap add ios' first"
fi

echo ""
echo "Done! Now run: npx cap sync"
