// Android seller alerts stay on the legacy notification payload until a
// specific device token proves it is running the native handler.
// Rollback: set seller_alert_android_config.mode to 'legacy',
// or set SELLER_ALERT_ANDROID_MODE=legacy on the function.

export const ORDER_ALERT_NATIVE_CAPABILITY = "order_alert_native_v1";
export const LEGACY_ANDROID_ORDER_CHANNEL = "orders_incoming_v2";
export const NATIVE_ANDROID_ORDER_CHANNEL = "orders_incoming_v3";

export type SellerAlertAndroidGate = {
  mode: "legacy" | "version_gated";
  minVersionCode: number;
};

const SAFE_LEGACY: SellerAlertAndroidGate = { mode: "legacy", minVersionCode: 67 };

export async function loadSellerAlertAndroidGate(supabase: any): Promise<SellerAlertAndroidGate> {
  try {
    if (Deno.env.get("SELLER_ALERT_ANDROID_MODE") === "legacy") return SAFE_LEGACY;
    const { data, error } = await supabase
      .from("seller_alert_android_config")
      .select("mode, min_version_code")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return SAFE_LEGACY;
    const mode = data.mode === "version_gated" ? "version_gated" : "legacy";
    const min = Number(data.min_version_code);
    return {
      mode,
      minVersionCode: Number.isFinite(min) && min > 0 ? min : SAFE_LEGACY.minVersionCode,
    };
  } catch {
    return SAFE_LEGACY;
  }
}

export function androidTokenUsesNativeAlert(
  token: { platform?: string | null; alert_capability?: string | null; app_version_code?: number | null },
  gate: SellerAlertAndroidGate,
): boolean {
  if (gate.mode !== "version_gated") return false;
  if (token.platform !== "android") return false;
  if (token.alert_capability !== ORDER_ALERT_NATIVE_CAPABILITY) return false;
  const code = Number(token.app_version_code);
  return Number.isFinite(code) && code >= gate.minVersionCode;
}
