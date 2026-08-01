import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Find sellers inactive for 7+ days who are still marked available
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: staleSellers, error: fetchError } = await supabase
      .from("seller_profiles")
      .select("id, user_id, business_name, last_active_at")
      .eq("is_available", true)
      .lt("last_active_at", sevenDaysAgo);

    if (fetchError) {
      console.error("Error fetching stale sellers:", fetchError);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!staleSellers || staleSellers.length === 0) {
      return new Response(
        JSON.stringify({ message: "No stale stores found", closed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sellerIds = staleSellers.map((s) => s.id);

    // Close stale stores
    const { error: updateError } = await supabase
      .from("seller_profiles")
      .update({ is_available: false })
      .in("id", sellerIds);

    if (updateError) {
      console.error("Error closing stale stores:", updateError);
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send push notifications to sellers via notification_queue
    const notifications = staleSellers
      .filter((s) => s.user_id)
      .map((s) => ({
        user_id: s.user_id,
        title: "🏪 Your store was closed due to inactivity",
        body: `${s.business_name || "Your store"} was inactive for 7+ days and was automatically closed. Re-open it anytime from your dashboard.`,
        type: "store_status",
        reference_path: "/seller/dashboard",
        payload: { type: "stale_store_closed", seller_id: s.id },
      }));

    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from("notification_queue")
        .insert(notifications);

      if (notifError) {
        console.warn("Failed to enqueue notifications:", notifError.message);
      }

      // Trigger push notification processing
      await supabase.functions.invoke("process-notification-queue").catch(() => {});
    }

    console.log(`Closed ${sellerIds.length} stale stores:`, sellerIds);

    return new Response(
      JSON.stringify({
        message: `Closed ${sellerIds.length} stale stores`,
        closed: sellerIds.length,
        sellers: staleSellers.map((s) => ({
          id: s.id,
          name: s.business_name,
          last_active: s.last_active_at,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
