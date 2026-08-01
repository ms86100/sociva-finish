import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all active sellers
    const { data: sellers, error: sellersErr } = await supabase
      .from("seller_profiles")
      .select("id, user_id, business_name")
      .eq("is_available", true)
      .eq("verification_status", "approved");

    if (sellersErr) throw sellersErr;
    if (!sellers || sellers.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    let sentCount = 0;

    for (const seller of sellers) {
      // Get today's stats
      const { data: todayOrders } = await supabase
        .from("orders")
        .select("id, total_amount, status")
        .eq("seller_id", seller.id)
        .gte("created_at", todayISO);

      const orders = todayOrders || [];
      const orderCount = orders.length;
      const revenue = orders
        .filter((o: any) => !["cancelled", "returned"].includes(o.status))
        .reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0);
      const pendingCount = orders.filter((o: any) => o.status === "placed").length;

      // Skip if no activity
      if (orderCount === 0) continue;

      const body = pendingCount > 0
        ? `Today: ${orderCount} orders, ₹${revenue.toLocaleString()} revenue, ${pendingCount} pending action${pendingCount > 1 ? "s" : ""}`
        : `Today: ${orderCount} orders, ₹${revenue.toLocaleString()} revenue. Great work! 🎉`;

      await supabase.from("notification_queue").insert({
        user_id: seller.user_id,
        type: "seller_daily_summary",
        title: `📊 Daily Summary — ${seller.business_name}`,
        body,
        reference_path: "/seller",
        payload: { type: "daily_summary", seller_id: seller.id, order_count: orderCount, revenue },
      });

      sentCount++;
    }

    return new Response(JSON.stringify({ sent: sentCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Daily seller summary error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
