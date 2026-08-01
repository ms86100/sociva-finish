# Codemagic Setup Guide

Build your iOS and Android apps in the cloud — no Mac required!

---

## Quick Start

1. **Connect GitHub** — Go to Settings → GitHub → Connect and push your project to GitHub
2. **Sign up for Codemagic** — Go to [codemagic.io](https://codemagic.io) and sign up (free tier available)
3. **Add your repository** — Connect the GitHub repo to Codemagic
4. **Configure secrets** — Add the required credentials (see below)
5. **Start build** — Trigger a build and Codemagic does the rest!

---

## Required Configuration

### For iOS Builds

#### 1. Apple Developer Account Connection

In Codemagic dashboard:
1. Go to **Teams** → **Personal Account** → **Integrations**
2. Click **App Store Connect** → **Connect**
3. Create an App Store Connect API Key in [Apple's portal](https://appstoreconnect.apple.com/access/api)
4. Upload the `.p8` key file to Codemagic

#### 2. Code Signing (Automatic)

Codemagic can handle code signing automatically:
1. In your workflow settings, enable **Automatic code signing**
2. Select your Apple Developer team
3. Codemagic creates and manages provisioning profiles for you

#### 3. Add GoogleService-Info.plist

1. Download from Firebase Console
2. Add to Codemagic as an environment variable:
   - Variable name: `GOOGLE_SERVICE_INFO_PLIST`
   - Value: Base64 encoded content of the file

```bash
# Encode the file
base64 -i GoogleService-Info.plist | pbcopy
```

---

### For Android Builds

#### 1. Create Keystore

If you don't have one, create it:

```bash
keytool -genkey -v \
  -keystore sociva-release.keystore \
  -alias sociva \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

#### 2. Add Keystore to Codemagic

1. Go to **Teams** → **Code signing identities** → **Android keystores**
2. Click **Add keystore**
3. Reference name: `sociva_keystore`
4. Upload your `.keystore` file
5. Enter keystore password, key alias, and key password

#### 3. Google Play Service Account

1. Go to [Google Play Console](https://play.google.com/console)
2. **Settings** → **API access** → **Create new service account**
3. Follow the link to Google Cloud Console
4. Create a service account with **Editor** role
5. Download the JSON key file
6. In Codemagic, add as environment variable:
   - Group name: `google_play`
   - Variable: `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`
   - Value: Contents of the JSON file

#### 4. Add google-services.json

1. Download from Firebase Console
2. Add to Codemagic as environment variable:
   - Variable: `GOOGLE_SERVICES_JSON`
   - Value: Base64 encoded content

---

## Available Workflows

| Workflow | What it does |
|----------|--------------|
| `ios-release` | Builds iOS app → Uploads to TestFlight |
| `android-release` | Builds Android app → Uploads to Play Store (internal) |
| `release-all` | Builds both platforms in one run |

---

## Triggering Builds

### Manual
1. Go to your app in Codemagic
2. Click **Start new build**
3. Select the workflow

### Automatic (on push)
Add triggers in `codemagic.yaml`:

```yaml
triggering:
  events:
    - push
  branch_patterns:
    - pattern: main
      include: true
```

---

## First Build Checklist

- [ ] GitHub repo connected to Codemagic
- [ ] App Store Connect API key added
- [ ] iOS code signing configured (or automatic enabled)
- [ ] Android keystore uploaded as `sociva_keystore`
- [ ] Google Play service account JSON added
- [ ] Firebase config files added (GoogleService-Info.plist, google-services.json)

---

## Estimated Build Times

| Platform | Time |
|----------|------|
| iOS only | ~15-20 minutes |
| Android only | ~10-15 minutes |
| Both platforms | ~25-30 minutes |

---

## Costs

Codemagic offers:
- **Free tier**: 500 build minutes/month
- **Pay as you go**: $0.038/minute for M2 Mac minis

A typical full release build uses ~30 minutes = ~$1.14

---

## Troubleshooting

### "No matching provisioning profiles"
→ Enable automatic code signing in Codemagic, or manually add profiles

### "Keystore not found"
→ Check the reference name matches `sociva_keystore` exactly

### "Google Play upload failed"
→ Ensure the service account has permission to manage your app in Play Console

---

## Support

- [Codemagic Docs](https://docs.codemagic.io)
- [Capacitor + Codemagic Guide](https://docs.codemagic.io/yaml-quick-start/building-a-capacitor-app/)
