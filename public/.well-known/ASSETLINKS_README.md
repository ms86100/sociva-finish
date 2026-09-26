# Digital Asset Links (`assetlinks.json`)

Verified Android App Links require a **live** file at:

`https://www.sociva.in/.well-known/assetlinks.json`  
(and ideally the same for `https://sociva.in/.well-known/assetlinks.json`)

## Replace the placeholder

1. Create or locate your Play App Signing / upload keystore.
2. Print the certificate SHA-256:

```bash
keytool -list -v -keystore path/to/sociva-release.keystore -alias sociva
```

Use the **SHA256** line (colons optional; Google accepts either form).

3. If you use **Play App Signing**, also add the **App signing key certificate** SHA-256 from Play Console → Setup → App signing (not only the upload key).

4. Replace `TODO_REPLACE_SHA256` in `assetlinks.json` with that fingerprint (you may list multiple fingerprints in the array).

5. Deploy the updated JSON to the production web host so it is reachable without redirects that strip the path. Content-Type should be `application/json`.

6. Verify:

```bash
adb shell pm get-app-links app.sociva.community
# or
curl -s https://www.sociva.in/.well-known/assetlinks.json
```

The fingerprint currently published in `assetlinks.json` is the upload keystore. Play App Signing uses a second certificate. Add that SHA-256 from Play Console, Setup, App signing, beside the existing one, then deploy this file. Until that second fingerprint is present, verified App Links can fail and HTTPS taps open in the browser. The share page still offers an Android intent for `app.sociva.community`, and the custom scheme `sociva://` still works without Asset Links.
