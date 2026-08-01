import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const IST_OFFSET_MS = 5.5 * 60 * 60_000;
    const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
    const currentHour = nowIST.getUTCHours();

    // Only run around 10 AM IST
    if (currentHour < 9 || currentHour > 11) {
      return new Response(
        JSON.stringify({ message: "Outside digest window (10 AM IST)", skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    // Get active buyers (ordered in last 30 days)
    const { data: recentBuyers } = await supabase
      .from("orders")
      .select("buyer_id, society_id")
      .eq("status", "completed")
      .gte("created_at", thirtyDaysAgo);

    if (!recentBuyers || recentBuyers.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active buyers", queued: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deduplicate buyers and get their society
    const buyerMap = new Map<string, string>();
    recentBuyers.forEach((b) => {
      if (b.buyer_id && b.society_id) buyerMap.set(b.buyer_id, b.society_id);
    });

    // Get dormant buyers (no order in last 7 days)
    const { data: recentActiveOrders } = await supabase
      .from("orders")
      .select("buyer_id")
      .gte("created_at", sevenDaysAgo);

    const recentActiveSet = new Set((recentActiveOrders || []).map((o) => o.buyer_id));

    // Get new products added in last 7 days per society
    const { data: newProducts } = await supabase
      .from("products")
      .select("id, name, seller_id, category, seller_profiles!inner(society_id, business_name)")
      .eq("status", "approved")
      .gte("created_at", sevenDaysAgo)
      .limit(50);

    // Get trending products (most viewed in last 7 days)
    const { data: trendingViews } = await supabase
      .from("product_views")
      .select("product_id, products(name)")
      .gte("viewed_at", sevenDaysAgo)
      .limit(200);

    // Count views per product
    const viewCounts = new Map<string, { name: string; count: number }>();
    (trendingViews || []).forEach((v: any) => {
      const existing = viewCounts.get(v.product_id);
      if (existing) {
        existing.count++;
      } else {
        viewCounts.set(v.product_id, { name: v.products?.name || "item", count: 1 });
      }
    });
    const trending = Array.from(viewCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    let totalQueued = 0;

    // Check if digest already sent today
    const { count: alreadySent } = await supabase
      .from("notification_queue")
      .select("id", { count: "exact", head: true })
      .eq("type", "buyer_digest")
      .gte("created_at", todayStart.toISOString());

    if (alreadySent && alreadySent > 0) {
      return new Response(
        JSON.stringify({ message: "Digest already sent today", skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const notifications: any[] = [];

    for (const [buyerId, societyId] of buyerMap) {
      const isDormant = !recentActiveSet.has(buyerId);
      const parts: string[] = [];

      // New products in their society
      const societyProducts = (newProducts || []).filter(
        (p: any) => p.seller_profiles?.society_id === societyId
      );
      if (societyProducts.length > 0) {
        const names = societyProducts.slice(0, 3).map((p: any) => p.name).join(", ");
        parts.push(`🆕 ${societyProducts.length} new item${societyProducts.length > 1 ? "s" : ""}: ${names}`);
      }

      // Trending items
      if (trending.length > 0) {
        const topName = trending[0][1].name;
        parts.push(`🔥 Trending: ${topName} (${trending[0][1].count} views this week)`);
      }

      // Dormant nudge
      if (isDormant) {
        parts.push("🛒 You haven't ordered in a while — check what's new!");
      }

      if (parts.length === 0) continue;

      const body = parts.join("\n");
      const title = isDormant ? "👋 We miss you!" : "📋 Your weekly marketplace update";

      notifications.push({
        user_id: buyerId,
        title,
        body,
        type: "buyer_digest",
        reference_path: "/",
        payload: {
          type: "buyer_digest",
          entity_type: "digest",
          is_dormant: isDormant,
          new_products_count: societyProducts.length,
        },
      });
    }

    // Batch insert
    for (let i = 0; i < notifications.length; i += 100) {
      const batch = notifications.slice(i, i + 100);
      await supabase.from("notification_queue").insert(batch);
    }
    totalQueued = notifications.length;

    // Trigger notification processing
    if (totalQueued > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/process-notification-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
      } catch (e) {
        console.warn("Failed to trigger notification queue:", e);
      }
    }

    return new Response(
      JSON.stringify({ message: `Buyer digest queued for ${totalQueued} users`, queued: totalQueued }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Buyer digest error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
