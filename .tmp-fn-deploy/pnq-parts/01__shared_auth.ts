import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

/**
 * Shared auth middleware for edge functions.
 * Extracts and validates Bearer token, returns userId and userClient.
 *
 * Usage:
 *   const authResult = await withAuth(req, corsHeaders);
 *   if (authResult instanceof Response) return authResult;
 *   const { userId, userClient } = authResult;
 */
export async function withAuth(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<{ userId: string; userClient: ReturnType<typeof createClient> } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return { userId: user.id, userClient };
}
