import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/auth.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";

/* cors: use corsHeadersFor(req) */

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  try {
    // Use shared auth middleware
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const body = await req.json();
    const { society_id, new_society } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Handle new society creation
    if (new_society && typeof new_society === "object") {
      // Rate limit: max 3 society creations per user per hour
      const rl = await checkRateLimit(`create-society:${userId}`, 3, 3600);
      if (!rl.allowed) return rateLimitResponse(corsHeaders);

      const { name, slug, address, city, state, pincode, latitude, longitude, google_place_id } = new_society;

      if (!name || !slug) {
        return new Response(
          JSON.stringify({ error: "new_society requires name and slug" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Sanitize slug
      const sanitizedSlug = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100);
      const sanitizedName = String(name).trim().slice(0, 200);

      if (!sanitizedSlug || sanitizedSlug.length < 3) {
        return new Response(
          JSON.stringify({ error: "Slug must be at least 3 alphanumeric characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Smart dedup: check resolve_society RPC before creating
      let matches: any[] | null = null;
      try {
        const { data } = await adminClient.rpc('resolve_society', {
          _input_name: sanitizedName,
          _lat: latitude || null,
          _lng: longitude || null,
          _google_place_id: google_place_id || null,
        });
        matches = data;
      } catch (rpcErr) {
        console.warn('resolve_society skipped:', rpcErr);
      }

      if (matches && matches.length > 0 && matches[0].confidence >= 0.8) {
        // Auto-merge: return existing society + save alias
        const normalized = sanitizedName.toLowerCase()
          .replace(/\s*(phase|ph|tower|block|wing|sec|sector)\s*[\d-]*/gi, '')
          .replace(/\s+/g, ' ').trim();
        try {
          await adminClient.from('society_aliases').upsert({
            society_id: matches[0].society_id,
            alias_name: sanitizedName,
            normalized_alias: normalized,
            google_place_id: google_place_id || null,
          }, { onConflict: 'normalized_alias' });
        } catch (aliasErr) {
          console.warn('society_aliases upsert skipped:', aliasErr);
        }

        const { data: matchedRow } = await adminClient
          .from("societies")
          .select("id, name, is_active, is_verified")
          .eq("id", matches[0].society_id)
          .maybeSingle();
        const joinable = !!(matchedRow?.is_active && matchedRow?.is_verified);
        return new Response(
          JSON.stringify({
            valid: joinable,
            matched: true,
            society: {
              id: matches[0].society_id,
              name: matches[0].society_name,
              is_active: !!matchedRow?.is_active,
              is_verified: !!matchedRow?.is_verified,
            },
          }),
          { status: joinable ? 200 : 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          error: "Societies are created by Sociva admin only. Pick an approved society or request it.",
          valid: false,
          registry_only: true,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle existing society validation - also rate-limited
    const rlValidate = await checkRateLimit(`validate-society:${userId}`, 20, 60);
    if (!rlValidate.allowed) return rateLimitResponse(corsHeaders);

    if (!society_id || typeof society_id !== "string") {
      return new Response(
        JSON.stringify({ error: "society_id or new_society is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(society_id)) {
      return new Response(
        JSON.stringify({ error: "Invalid society_id format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: society, error: societyError } = await adminClient
      .from("societies")
      .select("id, name, is_active, is_verified")
      .eq("id", society_id)
      .single();

    if (societyError || !society) {
      return new Response(
        JSON.stringify({ error: "Society not found", valid: false }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const joinable = !!(society.is_active && society.is_verified);
    return new Response(
      JSON.stringify({
        valid: joinable,
        society: {
          id: society.id,
          name: society.name,
          is_active: society.is_active,
          is_verified: society.is_verified,
        },
      }),
      { status: joinable ? 200 : 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
