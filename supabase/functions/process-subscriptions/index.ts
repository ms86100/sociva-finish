import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const today = new Date().toISOString().split('T')[0];

    // Get active subscriptions due today
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('*, product:products(name, price, seller_id), buyer:profiles!subscriptions_buyer_id_fkey(name, society_id)')
      .eq('status', 'active')
      .lte('next_delivery_date', today);

    if (!subs || subs.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let processed = 0;

    for (const sub of subs) {
      // Check delivery day for weekly
      if (sub.frequency === 'weekly' && sub.delivery_days?.length > 0) {
        const dayName = new Date().toLocaleDateString('en-US', { weekday: 'short' });
        if (!sub.delivery_days.includes(dayName)) continue;
      }

      // Create order
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          buyer_id: sub.buyer_id,
          seller_id: sub.seller_id,
          total_amount: (sub.product as any)?.price * sub.quantity,
          payment_type: 'cod',
          order_type: 'purchase',
          notes: `Auto-generated from subscription`,
        })
        .select('id')
        .single();

      if (orderErr || !order) continue;

      // Create order item
      await supabase.from('order_items').insert({
        order_id: order.id,
        product_id: sub.product_id,
        product_name: (sub.product as any)?.name || 'Subscription Item',
        quantity: sub.quantity,
        unit_price: (sub.product as any)?.price || 0,
      });

      // Record delivery
      await supabase.from('subscription_deliveries').insert({
        subscription_id: sub.id,
        order_id: order.id,
        scheduled_date: today,
      });

      // Calculate next delivery date
      let nextDate = new Date(sub.next_delivery_date);
      if (sub.frequency === 'daily') {
        nextDate.setDate(nextDate.getDate() + 1);
      } else if (sub.frequency === 'weekly') {
        nextDate.setDate(nextDate.getDate() + 7);
      } else if (sub.frequency === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + 1);
      }

      await supabase
        .from('subscriptions')
        .update({ next_delivery_date: nextDate.toISOString().split('T')[0] })
        .eq('id', sub.id);

      processed++;
    }

    return new Response(
      JSON.stringify({ processed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
