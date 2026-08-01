import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateOrderRequest {
  orderId?: string;
  orderIds?: string[];
  amount?: number;
  sellerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

async function getRazorpayKeys(supabase: any): Promise<{ keyId: string; keySecret: string } | null> {
  const { data: settings } = await supabase
    .from('admin_settings')
    .select('key, value, is_active')
    .in('key', ['razorpay_key_id', 'razorpay_key_secret']);

  if (settings && settings.length === 2) {
    const keyIdSetting = settings.find((s: any) => s.key === 'razorpay_key_id');
    const keySecretSetting = settings.find((s: any) => s.key === 'razorpay_key_secret');

    if (keyIdSetting?.value && keySecretSetting?.value && keyIdSetting.is_active && keySecretSetting.is_active) {
      return { keyId: keyIdSetting.value, keySecret: keySecretSetting.value };
    }
  }

  const envKeyId = Deno.env.get('RAZORPAY_KEY_ID');
  const envKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');

  if (envKeyId && envKeySecret) {
    return { keyId: envKeyId, keySecret: envKeySecret };
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const razorpayKeys = await getRazorpayKeys(supabase);
    if (!razorpayKeys) {
      console.error('Razorpay keys not configured');
      return new Response(
        JSON.stringify({ error: 'Payment gateway not configured. Please contact admin.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { withAuth } = await import("../_shared/auth.ts");
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;
    const user = { id: authResult.userId };

    const { allowed } = await checkRateLimit(`order:${user.id}`, 10, 60);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const body: CreateOrderRequest = await req.json();
    const { sellerId, customerName, customerEmail, customerPhone } = body;
    const clientAmount = body.amount;

    const allOrderIds: string[] = body.orderIds?.length ? body.orderIds : (body.orderId ? [body.orderId] : []);
    if (allOrderIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No order IDs provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate ALL orders belong to buyer, are not cancelled, and have payment_status: 'pending'
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('id, buyer_id, status, payment_status, razorpay_order_id, total_amount')
      .in('id', allOrderIds)
      .eq('buyer_id', user.id)
      .neq('status', 'cancelled')
      .eq('payment_status', 'pending');

    if (orderError || !orders || orders.length !== allOrderIds.length) {
      const foundIds = orders?.map((o: any) => o.id) || [];
      const missing = allOrderIds.filter(id => !foundIds.includes(id));
      console.error('Order validation failed. Expected:', allOrderIds.length, 'Found:', orders?.length, 'Missing:', missing);
      return new Response(
        JSON.stringify({ error: 'One or more orders not found, already cancelled, or already paid' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Amount from DB only — never trust client-supplied amount
    const dbAmount = orders.reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0);
    if (dbAmount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid order total' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (typeof clientAmount === 'number' && Math.abs(clientAmount - dbAmount) > 0.5) {
      console.warn('[create-razorpay-order] client amount ignored', { client: clientAmount, db: dbAmount });
    }

    console.log('Creating Razorpay order for orders:', allOrderIds, 'amount:', dbAmount, 'sellerId:', sellerId);

    // Idempotency: reuse existing Razorpay order if still valid
    const existingRzpId = orders[0]?.razorpay_order_id;
    const razorpayAuth = btoa(`${razorpayKeys.keyId}:${razorpayKeys.keySecret}`);
    if (existingRzpId) {
      try {
        const fetchRes = await fetch(`https://api.razorpay.com/v1/orders/${existingRzpId}`, {
          headers: { 'Authorization': `Basic ${razorpayAuth}` },
        });
        if (fetchRes.ok) {
          const existingOrder = await fetchRes.json();
          const existingPaise = Number(existingOrder.amount || 0);
          const expectedPaise = Math.round(dbAmount * 100);
          if (
            (existingOrder.status === 'created' || existingOrder.status === 'attempted') &&
            Math.abs(existingPaise - expectedPaise) <= 1
          ) {
            console.log('Reusing existing Razorpay order:', existingRzpId, 'status:', existingOrder.status);
            return new Response(
              JSON.stringify({
                razorpay_order_id: existingOrder.id,
                razorpay_key_id: razorpayKeys.keyId,
                amount: existingOrder.amount,
                currency: existingOrder.currency,
                prefill: { name: customerName, email: customerEmail, contact: customerPhone },
                notes: existingOrder.notes,
                reused: true,
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          console.log('Existing Razorpay order', existingRzpId, 'not reusable — creating new one');
        }
      } catch (e) {
        console.warn('Failed to fetch existing Razorpay order, creating new one:', e);
      }
    }

    const { data: seller } = await supabase
      .from('seller_profiles')
      .select('razorpay_account_id, business_name')
      .eq('id', sellerId)
      .single();

    const amountPaise = Math.round(dbAmount * 100);
    const orderPayload: any = {
      amount: amountPaise,
      currency: 'INR',
      receipt: allOrderIds[0],
      notes: {
        order_id: allOrderIds[0],
        order_ids: JSON.stringify(allOrderIds),
        seller_id: sellerId,
        buyer_id: user.id,
      },
    };

    if (allOrderIds.length === 1 && seller?.razorpay_account_id) {
      orderPayload.transfers = [
        {
          account: seller.razorpay_account_id,
          amount: amountPaise,
          currency: 'INR',
          notes: { order_id: allOrderIds[0], type: 'seller_payout' },
          on_hold: 0,
        },
      ];
    }

    console.log('Razorpay order payload:', orderPayload);

    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${razorpayAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    if (!razorpayResponse.ok) {
      const errorText = await razorpayResponse.text();
      console.error('Razorpay error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to create payment order', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const razorpayOrder = await razorpayResponse.json();
    console.log('Razorpay order created:', razorpayOrder.id, 'for', allOrderIds.length, 'orders');

    for (const oid of allOrderIds) {
      await supabase
        .from('orders')
        .update({ razorpay_order_id: razorpayOrder.id })
        .eq('id', oid);
    }

    return new Response(
      JSON.stringify({
        razorpay_order_id: razorpayOrder.id,
        razorpay_key_id: razorpayKeys.keyId,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        prefill: { name: customerName, email: customerEmail, contact: customerPhone },
        notes: razorpayOrder.notes,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error creating order:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
