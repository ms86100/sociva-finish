import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { order_id } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: "Missing order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Get original order — verify ownership
    const { data: originalOrder, error: orderErr } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, society_id, fulfillment_type, order_type, delivery_fee, discount_amount")
      .eq("id", order_id)
      .single();

    if (orderErr || !originalOrder) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (originalOrder.buyer_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get order items with seller_id from products
    const { data: items, error: itemsErr } = await supabase
      .from("order_items")
      .select("product_id, quantity, unit_price, products(id, price, approval_status, is_available, seller_id)")
      .eq("order_id", order_id);

    if (itemsErr || !items || items.length === 0) {
      return new Response(JSON.stringify({ error: "No items found in original order" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter to available + approved products and group by seller
    const sellerGroupsMap = new Map<string, { product_id: string; quantity: number; unit_price: number }[]>();
    let totalAmount = 0;

    for (const item of items) {
      const product = (item as any).products;
      if (!product || !product.is_available || product.approval_status !== 'approved') continue;

      const sellerId = product.seller_id as string;
      if (!sellerId) continue;

      const cartItem = {
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: product.price, // Use current price
      };

      if (!sellerGroupsMap.has(sellerId)) {
        sellerGroupsMap.set(sellerId, []);
      }
      sellerGroupsMap.get(sellerId)!.push(cartItem);
      totalAmount += cartItem.unit_price * cartItem.quantity;
    }

    if (sellerGroupsMap.size === 0) {
      return new Response(JSON.stringify({ error: "No items are currently available for reorder" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build _seller_groups JSON in the format the RPC expects
    const sellerGroups = Array.from(sellerGroupsMap.entries()).map(([sellerId, groupItems]) => ({
      seller_id: sellerId,
      items: groupItems.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
      })),
    }));

    // Use the authenticated user's client so auth.uid() matches _buyer_id inside the RPC
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: rpcResult, error: createErr } = await userClient
      .rpc("create_multi_vendor_orders", {
        _buyer_id: user.id,
        _seller_groups: sellerGroups,
        _delivery_address: "",
        _notes: "",
        _payment_method: "cod",
        _payment_status: "pending",
        _cart_total: totalAmount,
        _coupon_id: "",
        _coupon_code: "",
        _coupon_discount: 0,
        _has_urgent: false,
        _delivery_fee: 0,
        _fulfillment_type: originalOrder.fulfillment_type || "self_pickup",
        _delivery_address_id: null,
        _delivery_lat: null,
        _delivery_lng: null,
        _idempotency_key: `reorder_${order_id}_${user.id}`,
      });

    if (createErr) {
      console.error("Error creating reorder:", createErr);
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The RPC returns a JSON object with success/order_ids
    const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

    if (result && result.success === false) {
      return new Response(JSON.stringify({ error: result.error, details: result }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      orders: result?.order_ids || [],
      items_reordered: sellerGroups.reduce((sum, g) => sum + g.items.length, 0),
      total_amount: totalAmount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in quick-reorder:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
