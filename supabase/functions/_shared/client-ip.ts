/**
 * Extract client IP for rate limiting.
 *
 * Do not trust the leftmost X-Forwarded-For value (client-controllable).
 * Prefer platform headers, then the rightmost XFF hop (closest proxy).
 */
export function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  return "unknown";
}

/** Staging/QA OTP bypass must be explicitly enabled via Edge secret. */
export function isOtpBypassEnabled(): boolean {
  const value = (Deno.env.get("ALLOW_OTP_BYPASS") || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
