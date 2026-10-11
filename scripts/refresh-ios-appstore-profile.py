#!/usr/bin/env python3
"""Refresh the App Store profile for app.sociva.community.

App.entitlements requires Time Sensitive Notifications. Codemagic reuses the
uploaded profile "Sociva AppStore Distribution", which was created before that
capability, so xcodebuild exits 65 in Check dependencies. This recreates only
the main app's App Store profile. The widget profile is left alone.
"""

from __future__ import annotations

import base64
import json
import os
import plistlib
import subprocess
import sys
import tempfile

MAIN_BUNDLE = "app.sociva.community"
ENTITLEMENT = "com.apple.developer.usernotifications.time-sensitive"
PROFILE_NAME = "Sociva AppStore Time Sensitive"
PROFILE_DIRS = [
    os.path.expanduser("~/Library/MobileDevice/Provisioning Profiles"),
    os.path.expanduser("~/Library/Developer/Xcode/UserData/Provisioning Profiles"),
]


def run(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    print("+ " + " ".join(args), flush=True)
    result = subprocess.run(args, text=True, capture_output=True)
    if result.stdout:
        sys.stdout.write(result.stdout)
    if result.stderr:
        sys.stderr.write(result.stderr)
    if check and result.returncode != 0:
        raise SystemExit(result.returncode)
    return result


def parse_json(text: str):
    start = next((i for i, ch in enumerate(text) if ch in "[{"), None)
    if start is None:
        raise SystemExit("App Store Connect did not return JSON:\n" + text[:800])
    return json.loads(text[start:])


def as_list(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "profiles", "bundleIds", "certificates", "resources"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
        if payload.get("id") and payload.get("attributes"):
            return [payload]
    raise SystemExit("Unexpected App Store Connect JSON shape")


def decode_profile(content_b64: str) -> dict:
    raw = base64.b64decode(content_b64)
    with tempfile.NamedTemporaryFile(suffix=".mobileprovision", delete=False) as handle:
        handle.write(raw)
        path = handle.name
    try:
        plist_bytes = subprocess.check_output(["security", "cms", "-D", "-i", path])
    finally:
        os.remove(path)
    return plistlib.loads(plist_bytes)


def bundle_of(plist: dict) -> str:
    app_id = plist.get("Entitlements", {}).get("application-identifier", "")
    _team, _, bundle = app_id.partition(".")
    return bundle


def has_time_sensitive(plist: dict) -> bool:
    return plist.get("Entitlements", {}).get(ENTITLEMENT) is True


def profile_content(resource: dict) -> str | None:
    attributes = resource.get("attributes") or {}
    return attributes.get("profileContent")


def load_resource(resource: dict) -> dict:
    content = profile_content(resource)
    if content:
        return resource
    fetched = parse_json(run([
        "app-store-connect", "profiles", "get", resource["id"], "--json", "--no-color",
    ]).stdout)
    items = as_list(fetched)
    return items[0]


def main() -> None:
    listed = parse_json(run([
        "app-store-connect", "profiles", "list",
        "--type", "IOS_APP_STORE",
        "--json", "--no-color",
    ]).stdout)
    main_profiles = []
    for resource in as_list(listed):
        full = load_resource(resource)
        content = profile_content(full)
        if not content:
            continue
        plist = decode_profile(content)
        bundle = bundle_of(plist)
        if bundle != MAIN_BUNDLE:
            continue
        name = (full.get("attributes") or {}).get("name")
        uuid = plist.get("UUID")
        ok = has_time_sensitive(plist)
        print(f"Profile {name} uuid={uuid} time_sensitive={ok}", flush=True)
        main_profiles.append({"resource": full, "plist": plist, "ok": ok})

    good = next((item for item in main_profiles if item["ok"]), None)
    if good is None:
        if not main_profiles:
            raise SystemExit(f"No App Store profile found for {MAIN_BUNDLE}")
        source = main_profiles[0]["resource"]
        relationships = source.get("relationships") or {}
        bundle_id = ((relationships.get("bundleId") or {}).get("data") or {}).get("id")
        cert_ids = [
            item.get("id")
            for item in ((relationships.get("certificates") or {}).get("data") or [])
            if item.get("id")
        ]
        if not bundle_id or not cert_ids:
            raise SystemExit("Could not read the bundle id or certificate from the current App Store profile")
        create_args = [
            "app-store-connect", "profiles", "create", bundle_id,
            "--type", "IOS_APP_STORE",
            "--name", PROFILE_NAME,
            "--save", "--json", "--no-color",
        ]
        for cert_id in cert_ids:
            create_args.extend(["--certificate-ids", cert_id])
        created = parse_json(run(create_args).stdout)
        created_resource = load_resource(as_list(created)[0])
        created_plist = decode_profile(profile_content(created_resource) or "")
        if not has_time_sensitive(created_plist):
            run([
                "app-store-connect", "profiles", "delete", created_resource["id"],
                "--ignore-not-found", "--no-color",
            ], check=False)
            raise SystemExit(
                "Time Sensitive Notifications is still not on App ID "
                f"{MAIN_BUNDLE}. Enable it in Apple Developer, save, then rerun. "
                "The previous App Store profile was left in place."
            )
        print(f"Created {PROFILE_NAME} uuid={created_plist.get('UUID')}", flush=True)
        for stale in main_profiles:
            run([
                "app-store-connect", "profiles", "delete", stale["resource"]["id"],
                "--ignore-not-found", "--no-color",
            ])
        good = {"resource": created_resource, "plist": created_plist, "ok": True}

    content = profile_content(good["resource"])
    if not content:
        raise SystemExit("Refreshed profile has no profile content")
    raw = base64.b64decode(content)
    uuid = good["plist"].get("UUID") or "sociva-appstore"
    kept = f"{uuid}.mobileprovision"
    for directory in PROFILE_DIRS:
        os.makedirs(directory, exist_ok=True)
        for filename in os.listdir(directory):
            if not filename.endswith((".mobileprovision", ".provisionprofile")):
                continue
            path = os.path.join(directory, filename)
            try:
                plist_bytes = subprocess.check_output(["security", "cms", "-D", "-i", path])
                plist = plistlib.loads(plist_bytes)
            except (subprocess.CalledProcessError, plistlib.InvalidFileException, OSError):
                continue
            if bundle_of(plist) == MAIN_BUNDLE and not has_time_sensitive(plist):
                os.remove(path)
                print(f"Removed stale profile {path}", flush=True)
        destination = os.path.join(directory, kept)
        with open(destination, "wb") as handle:
            handle.write(raw)
        print(f"Installed {destination}", flush=True)
    print("=== App Store profile includes Time Sensitive Notifications ===", flush=True)


if __name__ == "__main__":
    main()
