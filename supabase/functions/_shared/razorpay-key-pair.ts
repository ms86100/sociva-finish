export type RazorpayKeySource = "env" | "rpc" | "rejected" | "";

export type RazorpayKeyPair = {
  keyId: string;
  keySecret: string;
  source: RazorpayKeySource;
};

export function sanitizeCredential(raw?: string | null): string {
  if (!raw) return "";
  let value = String(raw).replace(/^\uFEFF/, "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/[\r\n]+/g, "");
}

export function razorpayKeyMode(keyId: string): "live" | "test" | "unknown" {
  if (keyId.startsWith("rzp_live_")) return "live";
  if (keyId.startsWith("rzp_test_")) return "test";
  return "unknown";
}

/**
 * Never mix env key_id with vault/admin secret (or the reverse).
 * A split pair is the usual cause of Razorpay HTTP 401 "Authentication failed".
 */
export function selectRazorpayKeyPair(input: {
  envKeyId?: string | null;
  envKeySecret?: string | null;
  rpcKeyId?: string | null;
  rpcKeySecret?: string | null;
}): RazorpayKeyPair {
  const envId = sanitizeCredential(input.envKeyId);
  const envSecret = sanitizeCredential(input.envKeySecret);
  const rpcId = sanitizeCredential(input.rpcKeyId);
  const rpcSecret = sanitizeCredential(input.rpcKeySecret);

  if (envId && envSecret) {
    return { keyId: envId, keySecret: envSecret, source: "env" };
  }
  if (rpcId && rpcSecret) {
    return { keyId: rpcId, keySecret: rpcSecret, source: "rpc" };
  }
  return { keyId: "", keySecret: "", source: "" };
}

export function razorpayKeyCandidates(input: {
  envKeyId?: string | null;
  envKeySecret?: string | null;
  rpcKeyId?: string | null;
  rpcKeySecret?: string | null;
}): RazorpayKeyPair[] {
  const envId = sanitizeCredential(input.envKeyId);
  const envSecret = sanitizeCredential(input.envKeySecret);
  const rpcId = sanitizeCredential(input.rpcKeyId);
  const rpcSecret = sanitizeCredential(input.rpcKeySecret);
  const candidates: RazorpayKeyPair[] = [];
  if (envId && envSecret) {
    candidates.push({ keyId: envId, keySecret: envSecret, source: "env" });
  }
  if (rpcId && rpcSecret && (rpcId !== envId || rpcSecret !== envSecret)) {
    candidates.push({ keyId: rpcId, keySecret: rpcSecret, source: "rpc" });
  }
  return candidates;
}

export const RAZORPAY_GATEWAY_AUTH_FAILED =
  "We couldn't start the recharge. Your Sociva login is fine — the payment gateway rejected our request. Please try again shortly.";
