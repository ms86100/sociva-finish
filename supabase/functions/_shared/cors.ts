/**
 * Origin allowlist for browser-facing Edge Functions (staging hardening).
 * Reflects the request Origin when allowed; omits Allow-Origin when denied.
 */

const ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-cron-secret, x-razorpay-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

export const ALLOWED_ORIGINS: readonly string[] = [
  "https://sociva-integration.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
  "capacitor://www.sociva.in",
  "ionic://www.sociva.in",
  "https://sociva.in",
  "https://www.sociva.in",
  "https://app.sociva.in",
];

function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
  if (isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function handleCorsPreflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeadersFor(req) });
}