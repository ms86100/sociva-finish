import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature',
};

async function getRazorpayWebhookSecret(supabase: any): Promise<string | null> {
  // Prefer dedicated webhook secret — API key secret is NOT the webhook HMAC secret.
  // Fail closed: do not fall back to razorpay_key_secret (wrong secret → false accepts / rejects).
  const { data: settings } = await supabase
    .from('admin_settings')
    .select('key, value, is_active')
    .eq('key', 'razorpay_webhook_secret');

  const row = (settings || []).find((r: any) => r.value && r.is_active);
  if (row?.value) return row.value;

  const envWebhook = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  if (envWebhook) return envWebhook;

  console.error(
    '[razorpay-webhook] razorpay_webhook_secret missing or inactive — paste Webhook Secret from Razorpay Dashboard → Webhooks. Refusing to verify with API key secret.',
  );
  return null;
}

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(body)
    );
    
    const expectedBytes = new Uint8Array(signatureBuffer);
    
    const sigBytes = new Uint8Array(signature.length / 2);
    for (let i = 0; i < signature.length; i += 2) {
      sigBytes[i / 2] = parseInt(signature.substring(i, i + 2), 16);
    }
    
    if (expectedBytes.length !== sigBytes.length) return false;
    
    let diff = 0;
    for (let i = 0; i < expectedBytes.length; i++) {
      diff |= expectedBytes[i] ^ sigBytes[i];
    }
    return diff === 0;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/** Parse order IDs from payment notes — supports multi-vendor (order_ids) and single (order_id) */
function resolveOrderIds(notes: any): string[] {
  if (notes?.order_ids) {
    try {
      const parsed = JSON.parse(notes.order_ids);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through */ }
  }
  if (notes?.order_id) return [notes.order_id];
  return [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    const webhookSecret = await getRazorpayWebhookSecret(supabase);
    if (!webhookSecret) {
      console.error('Razorpay webhook secret not configured');
      return new Response(
        JSON.stringify({ error: 'Payment gateway not configured' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!signature) {
      console.error('Missing x-razorpay-signature header');
      return new Response(
        JSON.stringify({ error: 'Missing signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isValid = await verifySignature(body, signature, webhookSecret);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = JSON.parse(body);
    const event = payload.event;
    const paymentEntity = payload.payload?.payment?.entity;

    const webhookOrderIds = resolveOrderIds(paymentEntity?.notes);
    console.log(`[razorpay-webhook] event=${event}, razorpay_payment_id=${paymentEntity?.id}, order_ids=${JSON.stringify(webhookOrderIds)}, razorpay_order_id=${paymentEntity?.order_id || 'none'}`);

    if (event === 'payment.captured') {
      const razorpayPaymentId = paymentEntity.id;
      const allOrderIds = resolveOrderIds(paymentEntity.notes);

      if (allOrderIds.length === 0) {
        console.error('No order IDs found in payment notes — acknowledging to stop retries');
        return new Response(
          JSON.stringify({ acknowledged: true, skipped: 'no_order_id' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Payment ${razorpayPaymentId} captured for ${allOrderIds.length} order(s):`, allOrderIds);

      for (const orderId of allOrderIds) {
        // Prefer confirm-razorpay-payment for amount/notes binding + cancelled resurrection
        const confirmRes = await fetch(`${supabaseUrl}/functions/v1/confirm-razorpay-payment`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            razorpay_payment_id: razorpayPaymentId,
            razorpay_order_id: paymentEntity.order_id || null,
            order_ids: [orderId],
            source: 'webhook',
          }),
        });
        if (!confirmRes.ok) {
          const errText = await confirmRes.text();
          console.error(`[razorpay-webhook] confirm failed for ${orderId}:`, errText);
          continue;
        }
        console.log(`[razorpay-webhook] ✅ order=${orderId} result=confirmed razorpay_payment_id=${razorpayPaymentId}`);
      }
    } else if (event === 'payment.failed') {
      const allOrderIds = resolveOrderIds(paymentEntity.notes);

      for (const orderId of allOrderIds) {
        console.log(`Payment failed for order ${orderId}`);
        
        // Guard: never overwrite a 'paid' status with 'failed'
        await supabase
          .from('orders')
          .update({ payment_status: 'failed' })
          .eq('id', orderId)
          .neq('payment_status', 'paid');

        await supabase
          .from('payment_records')
          .update({ payment_status: 'failed' })
          .eq('order_id', orderId)
          .neq('payment_status', 'paid');
      }
    } else if (event === 'refund.created') {
      const allOrderIds = resolveOrderIds(paymentEntity.notes);

      for (const orderId of allOrderIds) {
        console.log(`Refund created for order ${orderId}`);
        
        // Guard: only refund orders that were actually paid
        await supabase
          .from('orders')
          .update({ payment_status: 'refunded' })
          .eq('id', orderId)
          .eq('payment_status', 'paid');

        await supabase
          .from('payment_records')
          .update({ payment_status: 'refunded' })
          .eq('order_id', orderId)
          .eq('payment_status', 'paid');
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
