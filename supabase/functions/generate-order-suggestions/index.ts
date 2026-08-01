import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const currentDay = nowIST.getUTCDay();
    const currentHour = nowIST.getUTCHours();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Check if called with specific buyer context (from auto-cancel)
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const targetBuyerId = body?.buyer_id;
    const cancelledOrderId = body?.cancelled_order_id;

    // Get users to analyze
    let uniqueUserIds: string[] = [];
    if (targetBuyerId) {
      uniqueUserIds = [targetBuyerId];
    } else {
      const { data: activeUsers, error: usersError } = await supabase
        .from('orders')
        .select('buyer_id')
        .eq('status', 'completed')
        .gte('created_at', thirtyDaysAgo);

      if (usersError) {
        return new Response(JSON.stringify({ error: usersError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      uniqueUserIds = [...new Set((activeUsers || []).map(o => o.buyer_id))];
    }

    let suggestionsCreated = 0;
    let notificationsSent = 0;

    for (const userId of uniqueUserIds) {
      // Get user's society
      const { data: profile } = await supabase
        .from('profiles')
        .select('society_id')
        .eq('id', userId)
        .single();

      // Get completed orders for this user in last 30 days
      const { data: orders } = await supabase
        .from('orders')
        .select('id, buyer_id, seller_id, created_at')
        .eq('buyer_id', userId)
        .eq('status', 'completed')
        .gte('created_at', thirtyDaysAgo);

      if (!orders || orders.length < 2) {
        // For cancelled order recovery: find similar sellers
        if (cancelledOrderId) {
          const { data: cancelledOrder } = await supabase
            .from('orders')
            .select('id, seller_id')
            .eq('id', cancelledOrderId)
            .single();

          if (cancelledOrder) {
            // Get items from cancelled order
            const { data: cancelledItems } = await supabase
              .from('order_items')
              .select('product_id')
              .eq('order_id', cancelledOrderId);

            const productIds = (cancelledItems || []).map(i => i.product_id);

            if (productIds.length > 0) {
              // Find other sellers with similar products
              const { data: altProducts } = await supabase
                .from('products')
                .select('id, seller_id, name, seller_profiles!inner(business_name)')
                .in('category', 
                  await supabase.from('products').select('category').in('id', productIds).then(r => (r.data || []).map(p => p.category))
                )
                .neq('seller_id', cancelledOrder.seller_id)
                .eq('status', 'approved')
                .limit(10);

              // Group by seller
              const sellerMap = new Map<string, string[]>();
              (altProducts || []).forEach((p: any) => {
                const existing = sellerMap.get(p.seller_id) || [];
                existing.push(p.id);
                sellerMap.set(p.seller_id, existing);
              });

              for (const [altSellerId, altProductIds] of sellerMap) {
                const sellerName = (altProducts || []).find((p: any) => p.seller_id === altSellerId)?.seller_profiles?.business_name || 'a seller';

                const { data: inserted } = await supabase.from('order_suggestions').insert({
                  user_id: userId,
                  society_id: profile?.society_id,
                  suggestion_type: 'recovery',
                  product_ids: altProductIds,
                  seller_id: altSellerId,
                  title: `Try ${sellerName}`,
                  description: `Similar items available from ${sellerName}`,
                  metadata: { source: 'auto_cancel_recovery', cancelled_order_id: cancelledOrderId },
                  is_dismissed: false,
                }).select('id').single();

                if (inserted) suggestionsCreated++;
                if (suggestionsCreated >= 3) break;
              }
            }
          }
        }
        continue;
      }

      // Get order items to find product patterns
      const orderIds = orders.map(o => o.id);
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('order_id, product_id')
        .in('order_id', orderIds);

      if (!orderItems || orderItems.length === 0) continue;

      // Build frequency map
      const patternMap = new Map<string, { productId: string; sellerId: string; day: number; hour: number; count: number }>();

      for (const item of orderItems) {
        const order = orders.find(o => o.id === item.order_id);
        if (!order) continue;

        const orderDate = new Date(order.created_at);
        const orderIST = new Date(orderDate.getTime() + IST_OFFSET_MS);
        const day = orderIST.getUTCDay();
        const hour = orderIST.getUTCHours();
        const key = `${item.product_id}:${order.seller_id}:${day}:${hour}`;

        const existing = patternMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          patternMap.set(key, { productId: item.product_id, sellerId: order.seller_id, day, hour, count: 1 });
        }
      }

      // Insert suggestions for patterns with ≥2 occurrences matching today's day
      for (const [, pattern] of patternMap) {
        if (pattern.count < 2 || pattern.day !== currentDay) continue;

        // Check if suggestion already exists for today
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        const { count: existingCount } = await supabase
          .from('order_suggestions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('seller_id', pattern.sellerId)
          .gte('created_at', todayStart.toISOString());

        if (existingCount && existingCount > 0) continue;

        // Get product + seller names for the suggestion
        const { data: product } = await supabase.from('products').select('name').eq('id', pattern.productId).single();
        const { data: seller } = await supabase.from('seller_profiles').select('business_name').eq('id', pattern.sellerId).single();

        const { data: insertedSuggestion } = await supabase.from('order_suggestions').insert({
          user_id: userId,
          society_id: profile?.society_id,
          suggestion_type: 'time_pattern',
          product_ids: [pattern.productId],
          seller_id: pattern.sellerId,
          title: `Order ${product?.name || 'your usual'} again?`,
          description: `You usually order from ${seller?.business_name || 'this seller'} around this time`,
          metadata: {
            trigger_type: 'time_pattern',
            day_of_week: pattern.day,
            time_bucket: pattern.hour,
            confidence_score: Math.min(0.99, 0.3 + (pattern.count * 0.15)),
          },
          is_dismissed: false,
        }).select('id').single();

        suggestionsCreated++;
        const suggestionId = insertedSuggestion?.id;

        // Send push notification if within ±1 hour of predicted time
        if (Math.abs(currentHour - pattern.hour) <= 1) {
          const reorderPath = suggestionId ? `/marketplace?reorder=${suggestionId}` : '/marketplace';

          await supabase.from('notification_queue').insert({
            user_id: userId,
            title: '🛒 Order again?',
            body: `You usually order ${product?.name || 'this item'} from ${seller?.business_name || 'this seller'} around this time.`,
            type: 'order_suggestion',
            reference_path: reorderPath,
            payload: {
              type: 'order_suggestion',
              entity_type: 'suggestion',
              entity_id: suggestionId ?? pattern.productId,
              workflow_status: 'suggested',
              action: 'Reorder',
              product_id: pattern.productId,
              seller_id: pattern.sellerId,
              suggestion_id: suggestionId,
            },
          });

          notificationsSent++;
        }
      }
    }

    return new Response(JSON.stringify({
      suggestions_created: suggestionsCreated,
      notifications_sent: notificationsSent,
      users_analyzed: uniqueUserIds.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in generate-order-suggestions:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
