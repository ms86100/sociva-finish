/**
 * Native GPS engine: Capacitor Geolocation only.
 *
 * Sociva does not ship Transistorsoft. A licensed SDK in the binary shows a
 * native "LICENSE VALIDATION FAILURE" banner on every cold start — including
 * buyers on Home. Seller sharing uses Capacitor Geolocation (keep the app open).
 */
export function getAndroidTransistorsoftLicensedCache(): boolean | null {
  return false;
}

export async function refreshNativeLocationEngineFlags(): Promise<boolean> {
  return false;
}

export function shouldUseTransistorsoftBackgroundGeo(): boolean {
  return false;
}
