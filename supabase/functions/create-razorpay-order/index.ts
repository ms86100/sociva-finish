import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { getRazorpayCredentials } from "../_shared/credentials.ts";
import {
  checkFinancialRuntime,
  financialRuntimeUnavailableResponse,
} from "../_shared/financial-runtime.ts";

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
  const keys = await getRazorpayCredentials(supabase);
  if (!keys.keyId || !keys.keySecret) return null;
  return keys;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const runtime = await checkFinancialRuntime(
      supabase,
      'payment_ready',
      'payment_create_enabled',
    );
    if (!runtime.ready) {
      return financialRuntimeUnavailableResponse(runtime, corsHeaders);
    }

    const { withAuth } = await import("../_shared/auth.ts");
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;
    const user = { id: authResult.userId };

    const razorpayKeys = await getRazorpayKeys(supabase);
    if (!razorpayKeys) {
      console.error('Razorpay keys not configured');
      return new Response(
        JSON.stringify({ error: 'Payment gateway not configured. Please contact admin.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      .select('id, buyer_id, seller_id, status, payment_status, razorpay_order_id, total_amount, checkout_group_id')
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

    const uniqueSellers = new Set(orders.map((o: any) => o.seller_id).filter(Boolean));
    const isMultiSeller = uniqueSellers.size > 1;

    // All online orders use platform-collect. Seller transfers are created only
    // by the deferred settlement worker after fulfilment and reconciliation.
    const resolvedSellerId = [...uniqueSellers][0] as string | undefined;
    if (!resolvedSellerId) {
      return new Response(
        JSON.stringify({ error: 'Order is missing seller_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!isMultiSeller && sellerId && sellerId !== resolvedSellerId) {
      console.warn('Client sellerId mismatch; using order seller_id', { sellerId, resolvedSellerId });
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

    console.log('Creating Razorpay order for orders:', allOrderIds, 'amount:', dbAmount, 'sellerId:', resolvedSellerId);

    // Platform collect once. Never attach a Route transfer here: doing so would
    // race with process-settlements and could pay a seller twice.

    const checkoutGroupId =
      orders.map((o: any) => o.checkout_group_id).find((id: string | null) => !!id) || null;

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
            const { data: repairedLink, error: repairedLinkError } = await supabase.rpc(
              'link_razorpay_order_group',
              {
                p_order_ids: allOrderIds,
                p_razorpay_order_id: existingOrder.id,
                p_checkout_group_id: checkoutGroupId,
              },
            );
            if (repairedLinkError || repairedLink?.linked !== true) {
              throw new Error(
                `existing_provider_order_link_repair_failed:${repairedLinkError?.message || 'not_linked'}`,
              );
            }
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

    const amountPaise = Math.round(dbAmount * 100);
    const deterministicReceipt = `sociva_${checkoutGroupId || allOrderIds[0]}`
      .replace(/-/g, '')
      .slice(0, 40);
    const orderPayload: any = {
      amount: amountPaise,
      currency: 'INR',
      receipt: deterministicReceipt,
      notes: {
        order_id: allOrderIds[0],
        order_ids: JSON.stringify(allOrderIds),
        seller_id: isMultiSeller ? 'multi' : resolvedSellerId,
        seller_ids: JSON.stringify([...uniqueSellers]),
        buyer_id: user.id,
        checkout_group_id: checkoutGroupId || '',
        platform_collect: '1',
      },
    };

    console.log('Razorpay order payload:', orderPayload);

    // Recover a provider order created before a crash/database-link failure.
    // Paginate so a high receipt-collision volume never hides the correct order.
    const expectedIds = [...allOrderIds].sort();
    let razorpayOrder: any = null;
    for (let skip = 0; skip < 1_000 && !razorpayOrder; skip += 100) {
      const recoveryResponse = await fetch(
        `https://api.razorpay.com/v1/orders?receipt=${encodeURIComponent(deterministicReceipt)}&count=100&skip=${skip}`,
        { headers: { 'Authorization': `Basic ${razorpayAuth}` } },
      );
      if (!recoveryResponse.ok) break;
      const recoveryBody = await recoveryResponse.json().catch(() => ({}));
      const items: any[] = recoveryBody?.items || [];
      razorpayOrder = items.find((candidate: any) => {
        let candidateIds: string[] = [];
        try {
          candidateIds = JSON.parse(candidate?.notes?.order_ids || '[]').map(String).sort();
        } catch {
          candidateIds = [];
        }
        return (
          candidate?.receipt === deterministicReceipt &&
          Number(candidate?.amount) === amountPaise &&
          String(candidate?.currency || '').toUpperCase() === 'INR' &&
          JSON.stringify(candidateIds) === JSON.stringify(expectedIds) &&
          ['created', 'attempted'].includes(String(candidate?.status || ''))
        );
      }) || null;
      if (items.length < 100) break;
    }

    const razorpayResponse = razorpayOrder ? null : await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${razorpayAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    if (razorpayResponse && !razorpayResponse.ok) {
      const errorText = await razorpayResponse.text();
      console.error('Razorpay error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to create payment order', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!razorpayOrder && razorpayResponse) {
      razorpayOrder = await razorpayResponse.json();
    }
    if (!razorpayOrder?.id) {
      throw new Error('provider_order_create_or_recovery_missing_id');
    }
    console.log('Razorpay order created:', razorpayOrder.id, 'for', allOrderIds.length, 'orders');

    const { data: linkedGroup, error: linkErr } = await supabase.rpc(
      'link_razorpay_order_group',
      {
        p_order_ids: allOrderIds,
        p_razorpay_order_id: razorpayOrder.id,
        p_checkout_group_id: checkoutGroupId,
      },
    );
    if (linkErr || linkedGroup?.linked !== true) {
      console.error('Provider order created but atomic linkage failed', linkErr);
      return new Response(
        JSON.stringify({
          error: 'Payment order created but failed to link atomically',
          details: linkErr?.message || 'not_linked',
          razorpay_order_id: razorpayOrder.id,
          retryable: true,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
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
