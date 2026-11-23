/**
 * Worker / cron authorization for Edge Functions.
 * Accepts service-role bearer OR exact match of x-cron-secret to CRON_SECRET
 * (and optionally PNQ_WORKER_SECRET when that vault secret is used by pg_net).
 * Never authorize on secret length alone.
 */

export function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") || "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

export function isServiceRoleRequest(
  req: Request,
  serviceKey: string,
): boolean {
  if (!serviceKey) return false;
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = getBearerToken(req);
  return authHeader === `Bearer ${serviceKey}` || bearer === serviceKey;
}

function secretMatches(incoming: string, envName: string): boolean {
  const expected = (Deno.env.get(envName) || "").trim();
  return expected.length > 0 && incoming.length > 0 && incoming === expected;
}

/** Exact cron/worker secret match only - no length-based bypass. */
export function isCronSecretRequest(req: Request): boolean {
  const incoming = (req.headers.get("x-cron-secret") || "").trim();
  if (!incoming) return false;
  return (
    secretMatches(incoming, "CRON_SECRET") ||
    secretMatches(incoming, "PNQ_WORKER_SECRET")
  );
}

/** Service role or exact cron/worker secret. */
export function isAuthorizedWorker(
  req: Request,
  serviceKey: string,
): boolean {
  return isServiceRoleRequest(req, serviceKey) || isCronSecretRequest(req);
}
