import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { getRazorpayWebhookSecret as resolveWebhookSecret } from "../_shared/credentials.ts";
import { verifyRazorpaySignature } from "../_shared/razorpay-signature.ts";
import {
  checkFinancialRuntime,
  financialRuntimeUnavailableResponse,
} from "../_shared/financial-runtime.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature',
};

async function getRazorpayWebhookSecret(supabase: any): Promise<string | null> {
  // Prefer Deno.env / Vault — never fall back to razorpay_key_secret (wrong HMAC).
  const secret = await resolveWebhookSecret(supabase);
  if (secret) return secret;

  console.error(
    '[razorpay-webhook] razorpay_webhook_secret missing — paste Webhook Secret from Razorpay Dashboard → Webhooks. Refusing to verify with API key secret.',
  );
  return null;
}

/** Parse order IDs from payment notes — supports multi-vendor (order_ids) and single (order_id) */
function resolveOrderIds(notes: any): string[] {
  if (notes?.order_ids) {
    try {
      const parsed = typeof notes.order_ids === 'string'
        ? JSON.parse(notes.order_ids)
        : notes.order_ids;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
    } catch { /* fall through */ }
  }
  if (notes?.order_id) return [String(notes.order_id)];
  return [];
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let eventStore: any = null;
  let providerEventRowId: string | null = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    // Reject malformed JSON before any database preflight, provider lookup, or
    // mutation. Event routing remains untrusted until HMAC verification.
    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Malformed JSON payload' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
    const event = payload.event;
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

    const isValid = await verifyRazorpaySignature(body, signature, webhookSecret);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sellerCreditCaptured =
      String(event || '') === 'payment.captured' &&
      payload.payload?.payment?.entity?.notes?.purpose === 'seller_credit_purchase';

    if (!sellerCreditCaptured) {
      const requiredCapability = String(event || '').startsWith('transfer.')
        ? 'payout_ready'
        : String(event || '').startsWith('refund.') ||
            String(event || '').startsWith('payment.dispute.')
        ? 'refund_ready'
        : 'payment_ready';
      const requiredEnablement = String(event || '').startsWith('transfer.')
        ? 'payout_processing_enabled'
        : String(event || '').startsWith('refund.') ||
            String(event || '').startsWith('payment.dispute.')
        ? 'webhook_refund_enabled'
        : 'webhook_capture_enabled';
      const runtime = await checkFinancialRuntime(
        supabase,
        requiredCapability,
        requiredEnablement,
      );
      if (!runtime.ready) {
        return financialRuntimeUnavailableResponse(runtime, corsHeaders);
      }
    }

    const paymentEntity = payload.payload?.payment?.entity;
    const refundEntity = payload.payload?.refund?.entity;
    const transferEntity = payload.payload?.transfer?.entity;
    const disputeEntity = payload.payload?.dispute?.entity;
    const payloadFingerprint = await sha256Hex(body);
    const providerEventId =
      req.headers.get('x-razorpay-event-id') || `sha256:${payloadFingerprint}`;

    eventStore = supabase;
    const leaseStartedAt = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { data: existingEvent } = await supabase
      .from('payment_provider_events')
      .select('id, processing_status, retry_count, lease_expires_at')
      .eq('provider', 'razorpay')
      .eq('event_id', providerEventId)
      .maybeSingle();

    if (existingEvent?.processing_status === 'processed') {
      return new Response(
        JSON.stringify({ received: true, deduplicated: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (existingEvent?.id) {
      const { data: claimedEvent, error: claimError } = await supabase
        .from('payment_provider_events')
        .update({
          processing_status: 'retrying',
          retry_count: Number(existingEvent.retry_count || 0) + 1,
          error_message: null,
          locked_at: leaseStartedAt,
          lease_expires_at: leaseExpiresAt,
        })
        .eq('id', existingEvent.id)
        .or(
          `processing_status.eq.failed,lease_expires_at.is.null,lease_expires_at.lt.${leaseStartedAt}`,
        )
        .select('id')
        .maybeSingle();
      if (claimError || !claimedEvent?.id) {
        return new Response(
          JSON.stringify({ received: true, deduplicated: true, in_progress: true }),
          { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      providerEventRowId = claimedEvent.id;
    } else {
      const { data: insertedEvent, error: eventInsertError } = await supabase
        .from('payment_provider_events')
        .insert({
          provider: 'razorpay',
          event_id: providerEventId,
          event_type: event || 'unknown',
          payload,
          signature,
          processing_status: 'processing',
          locked_at: leaseStartedAt,
          lease_expires_at: leaseExpiresAt,
        })
        .select('id')
        .single();
      if (eventInsertError || !insertedEvent?.id) {
        // A concurrent delivery may have won the unique key. Returning a retry
        // is safer than processing an event without durable inbox evidence.
        console.error('[razorpay-webhook] failed to persist provider event', eventInsertError);
        return new Response(
          JSON.stringify({ error: 'provider_event_persistence_failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      providerEventRowId = insertedEvent.id;
    }

    const webhookOrderIds = resolveOrderIds(paymentEntity?.notes || refundEntity?.notes);
    console.log(`[razorpay-webhook] event=${event}, razorpay_payment_id=${paymentEntity?.id || refundEntity?.payment_id}, transfer_id=${transferEntity?.id || 'none'}, order_ids=${JSON.stringify(webhookOrderIds)}, razorpay_order_id=${paymentEntity?.order_id || 'none'}`);

    if (event === 'payment.captured') {
      const razorpayPaymentId = paymentEntity.id;
      if (paymentEntity?.notes?.purpose === 'seller_credit_purchase') {
        const confirmCredit = await fetch(`${supabaseUrl}/functions/v1/confirm-seller-credit-payment`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            razorpay_payment_id: razorpayPaymentId,
            razorpay_order_id: paymentEntity.order_id || null,
            purchase_id: paymentEntity.notes.purchase_id,
            source: 'webhook',
          }),
        });
        if (!confirmCredit.ok) {
          const errText = await confirmCredit.text();
          throw new Error(`seller_credit_confirm_failed:${errText}`);
        }
        await supabase
          .from('payment_provider_events')
          .update({ processing_status: 'processed' })
          .eq('id', providerEventRowId);
        return new Response(JSON.stringify({ ok: true, purpose: 'seller_credit_purchase' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      let allOrderIds = resolveOrderIds(paymentEntity.notes);
      if (allOrderIds.length === 0 && paymentEntity?.order_id) {
        const { data: linkedOrders, error: linkedOrdersError } = await supabase
          .from('orders')
          .select('id')
          .eq('razorpay_order_id', String(paymentEntity.order_id));
        if (linkedOrdersError) {
          throw new Error(`provider_order_link_lookup_failed:${linkedOrdersError.message}`);
        }
        allOrderIds = (linkedOrders || []).map((row: { id: string }) => row.id);
      }

      if (allOrderIds.length === 0) {
        console.error('No order IDs found for captured provider payment');
        await supabase
          .from('payment_provider_events')
          .update({
            processing_status: 'failed',
            error_message: 'captured_payment_linkage_missing',
          })
          .eq('id', providerEventRowId);
        return new Response(
          JSON.stringify({ error: 'captured_payment_linkage_missing', retryable: true }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const providerCreatedAt = Number(paymentEntity?.created_at);
      const { data: attemptResult, error: attemptError } = await supabase.rpc(
        'register_payment_attempt_event',
        {
          p_provider: 'razorpay',
          p_provider_payment_id: String(razorpayPaymentId),
          p_provider_order_id: paymentEntity?.order_id
            ? String(paymentEntity.order_id)
            : null,
          p_order_ids: allOrderIds,
          p_status: 'captured',
          p_amount_minor: Number(paymentEntity?.amount),
          p_currency: String(paymentEntity?.currency || 'INR'),
          p_failure_code: null,
          p_failure_description: null,
          p_provider_created_at: Number.isFinite(providerCreatedAt)
            ? new Date(providerCreatedAt * 1000).toISOString()
            : null,
          p_event_id: providerEventId,
          p_payload_fingerprint: payloadFingerprint,
        },
      );
      if (attemptError || attemptResult?.ok !== true) {
        throw new Error(
          `captured_attempt_registration_failed:${attemptError?.message || 'not_registered'}`,
        );
      }

      console.log(`Payment ${razorpayPaymentId} captured for ${allOrderIds.length} order(s) — confirming as ONE group:`, allOrderIds);

      // P0: ONE confirm call with FULL order_ids — never one-at-a-time amount binding
      const confirmRes = await fetch(`${supabaseUrl}/functions/v1/confirm-razorpay-payment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          razorpay_payment_id: razorpayPaymentId,
          razorpay_order_id: paymentEntity.order_id || null,
          order_ids: allOrderIds,
          source: 'webhook',
        }),
      });

      if (!confirmRes.ok) {
        const errText = await confirmRes.text();
        console.error(`[razorpay-webhook] confirm failed for group:`, errText);
        await supabase
          .from('payment_provider_events')
          .update({
            processing_status: 'failed',
            error_message: `confirm_failed:${errText.slice(0, 800)}`,
          })
          .eq('id', providerEventRowId);
        return new Response(
          JSON.stringify({
            error: 'confirm_failed',
            status: confirmRes.status,
            body: errText.slice(0, 800),
            order_ids: allOrderIds,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const confirmBody = await confirmRes.json().catch(() => ({}));
      // Fail closed: confirm may return 200 with success:false
      if (confirmBody?.success === false) {
        console.error('[razorpay-webhook] confirm returned success:false', confirmBody);
        await supabase
          .from('payment_provider_events')
          .update({
            processing_status: 'failed',
            error_message: 'confirm_incomplete',
          })
          .eq('id', providerEventRowId);
        return new Response(
          JSON.stringify({ error: 'confirm_incomplete', result: confirmBody }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      console.log(`[razorpay-webhook] ✅ group confirmed razorpay_payment_id=${razorpayPaymentId} orders=${allOrderIds.length}`);
    } else if (event === 'payment.failed') {
      let allOrderIds = resolveOrderIds(paymentEntity?.notes);
      if (allOrderIds.length === 0 && paymentEntity?.order_id) {
        const { data: linkedOrders, error: linkedOrdersError } = await supabase
          .from('orders')
          .select('id')
          .eq('razorpay_order_id', String(paymentEntity.order_id));
        if (linkedOrdersError) {
          throw new Error(`provider_order_link_lookup_failed:${linkedOrdersError.message}`);
        }
        allOrderIds = (linkedOrders || []).map((row: { id: string }) => row.id);
      }
      if (!paymentEntity?.id || allOrderIds.length === 0) {
        throw new Error('failed_payment_attempt_linkage_missing');
      }

      const providerCreatedAt = Number(paymentEntity?.created_at);
      const { data: attemptResult, error: attemptError } = await supabase.rpc(
        'register_payment_attempt_event',
        {
          p_provider: 'razorpay',
          p_provider_payment_id: String(paymentEntity.id),
          p_provider_order_id: paymentEntity?.order_id
            ? String(paymentEntity.order_id)
            : null,
          p_order_ids: allOrderIds,
          p_status: 'failed',
          p_amount_minor: Number(paymentEntity?.amount),
          p_currency: String(paymentEntity?.currency || 'INR'),
          p_failure_code: paymentEntity?.error_code
            ? String(paymentEntity.error_code)
            : null,
          p_failure_description: paymentEntity?.error_description
            ? String(paymentEntity.error_description)
            : null,
          p_provider_created_at: Number.isFinite(providerCreatedAt)
            ? new Date(providerCreatedAt * 1000).toISOString()
            : null,
          p_event_id: providerEventId,
          p_payload_fingerprint: payloadFingerprint,
        },
      );
      if (attemptError || attemptResult?.ok !== true) {
        throw new Error(
          `failed_attempt_registration_failed:${attemptError?.message || 'not_registered'}`,
        );
      }
      console.log(
        `[razorpay-webhook] recorded failed attempt ${paymentEntity.id}; order truth unchanged`,
      );
      // Push failure signal to the frontend via Realtime.
      // record_payment_attempt_failure only touches payment_pending orders,
      // so a concurrently-captured order is never overwritten.
      if (allOrderIds.length > 0) {
        await supabase.rpc('record_payment_attempt_failure', {
          p_order_ids: allOrderIds,
          p_failure_code: paymentEntity?.error_code
            ? String(paymentEntity.error_code)
            : null,
          p_failure_description: paymentEntity?.error_description
            ? String(paymentEntity.error_description)
            : paymentEntity?.error_reason
            ? String(paymentEntity.error_reason)
            : null,
        }).then(({ error }: { error: any }) => {
          if (error) console.warn('[razorpay-webhook] record_payment_attempt_failure:', error.message);
        });
      }
    } else if (
      event === 'payment.dispute.created' ||
      event === 'payment.dispute.won' ||
      event === 'payment.dispute.lost'
    ) {
      if (!disputeEntity?.id || !disputeEntity?.payment_id) {
        throw new Error('chargeback_event_missing_identity');
      }
      const disputeStatus = event.endsWith('.won')
        ? 'won'
        : event.endsWith('.lost')
        ? 'lost'
        : disputeEntity?.evidence_due_by
        ? 'evidence_due'
        : 'opened';
      const { data: chargebackId, error: chargebackError } = await supabase.rpc(
        'record_provider_chargeback',
        {
          p_provider: 'razorpay',
          p_provider_case_id: String(disputeEntity.id),
          p_provider_payment_id: String(disputeEntity.payment_id),
          p_amount_minor: Number(disputeEntity.amount || 0),
          p_status: disputeStatus,
          p_raw_payload: disputeEntity,
        },
      );
      if (chargebackError || !chargebackId) {
        throw new Error(
          `chargeback_record_failed:${chargebackError?.message || 'missing_case_id'}`,
        );
      }
    } else if (event === 'transfer.processed' || event === 'transfer.failed') {
      const providerTransferId = transferEntity?.id
        ? String(transferEntity.id)
        : null;
      if (!providerTransferId) {
        throw new Error('transfer_webhook_missing_id');
      }
      const { data: attempt } = await supabase
        .from('payout_attempts')
        .select('id, status, amount_minor, settlement_id, destination:seller_payout_destinations(provider_reference)')
        .eq('provider', 'razorpay_route')
        .eq('provider_transfer_id', providerTransferId)
        .maybeSingle();
      if (!attempt?.id) {
        await supabase.from('financial_reconciliation_records').upsert(
          {
            provider: 'razorpay_route',
            reconciliation_date: new Date().toISOString().slice(0, 10),
            reference_type: 'payout_transfer',
            reference_id: providerTransferId,
            provider_amount_minor: Number(transferEntity?.amount || 0),
            status: 'open',
            reason: 'Transfer webhook has no exact local payout attempt',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'provider,reconciliation_date,reference_type,reference_id' },
        );
      } else if (event === 'transfer.processed' && attempt.status !== 'succeeded') {
        const destinationReference = Array.isArray(attempt.destination)
          ? attempt.destination[0]?.provider_reference
          : attempt.destination?.provider_reference;
        const providerAmount = Number(transferEntity?.amount);
        const providerCurrency = String(transferEntity?.currency || '').toUpperCase();
        const providerDestination = String(
          transferEntity?.recipient || transferEntity?.account || '',
        );
        const providerSettlementId = String(transferEntity?.notes?.settlement_id || '');
        const transferMatchesAttempt =
          Number.isSafeInteger(providerAmount) &&
          providerAmount === Number(attempt.amount_minor) &&
          providerCurrency === 'INR' &&
          !!destinationReference &&
          providerDestination === destinationReference &&
          providerSettlementId === String(attempt.settlement_id);

        if (!transferMatchesAttempt) {
          await supabase.from('financial_reconciliation_records').upsert(
            {
              provider: 'razorpay_route',
              reconciliation_date: new Date().toISOString().slice(0, 10),
              reference_type: 'payout_transfer',
              reference_id: providerTransferId,
              internal_amount_minor: Number(attempt.amount_minor),
              provider_amount_minor: Number.isSafeInteger(providerAmount)
                ? providerAmount
                : null,
              status: 'open',
              reason: 'Processed transfer amount, currency, destination, or settlement identity mismatched payout attempt',
              metadata: {
                attempt_id: attempt.id,
                expected_destination: destinationReference || null,
                provider_destination: providerDestination || null,
                expected_settlement_id: attempt.settlement_id,
                provider_settlement_id: providerSettlementId || null,
                provider_currency: providerCurrency || null,
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'provider,reconciliation_date,reference_type,reference_id' },
          );
          throw new Error('transfer_identity_or_amount_mismatch');
        }

        const { data: finalized, error: finalizeError } = await supabase.rpc(
          'finalize_seller_payout',
          {
            p_attempt_id: attempt.id,
            p_provider_transfer_id: providerTransferId,
          },
        );
        if (finalizeError || finalized?.finalized !== true) {
          throw new Error(
            `transfer_finalize_failed:${finalizeError?.message || 'not_finalized'}`,
          );
        }
      } else if (event === 'transfer.failed' && attempt.status === 'succeeded') {
        await supabase.from('financial_reconciliation_records').upsert(
          {
            provider: 'razorpay_route',
            reconciliation_date: new Date().toISOString().slice(0, 10),
            reference_type: 'payout_transfer',
            reference_id: providerTransferId,
            internal_amount_minor: Number(attempt.amount_minor),
            provider_amount_minor: Number(transferEntity?.amount || 0),
            status: 'open',
            reason: 'Provider sent transfer.failed after local payout was already succeeded',
            metadata: { attempt_id: attempt.id, terminal_conflict: true },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'provider,reconciliation_date,reference_type,reference_id' },
        );
      } else if (
        event === 'transfer.failed' &&
        ['processing', 'reconciliation_required'].includes(attempt.status)
      ) {
        const { error: holdError } = await supabase.rpc(
          'hold_failed_seller_payout',
          {
            p_attempt_id: attempt.id,
            p_unknown: false,
            p_error: String(
              transferEntity?.error_description ||
              transferEntity?.status ||
              'provider transfer failed',
            ),
            p_provider_transfer_id: providerTransferId,
          },
        );
        if (holdError) throw new Error(`transfer_hold_failed:${holdError.message}`);
      }
    } else if (event === 'refund.created' || event === 'refund.processed') {
      // P0: NEVER raw-update orders.payment_status='refunded'.
      // Drive idempotent complete_refund / reconcile by gateway_refund_id only.
      const gatewayRefundId = refundEntity?.id as string | undefined;
      const gatewayStatus = refundEntity?.status || event;
      const paymentId = refundEntity?.payment_id || paymentEntity?.id;
      const notedRefundRequestId = refundEntity?.notes?.refund_request_id
        ? String(refundEntity.notes.refund_request_id)
        : null;

      if (!gatewayRefundId) {
        console.warn('[razorpay-webhook] refund event missing refund.id — ack without mutating orders');
        await supabase
          .from('payment_provider_events')
          .update({
            processing_status: 'processed',
            processed_at: new Date().toISOString(),
            error_message: 'skipped:no_gateway_refund_id',
          })
          .eq('id', providerEventRowId);
        return new Response(
          JSON.stringify({ acknowledged: true, skipped: 'no_gateway_refund_id' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      let matchedRefundId = notedRefundRequestId;
      if (!matchedRefundId) {
        const { data: exactRefund } = await supabase
          .from('refund_requests')
          .select('id')
          .eq('gateway_refund_id', gatewayRefundId)
          .maybeSingle();
        matchedRefundId = exactRefund?.id || null;
      }

      if (!matchedRefundId) {
        // A payment-level aggregate is insufficient for multi-order partial
        // refunds. Record an exception without guessing which request matched.
        await supabase.from('financial_reconciliation_records').upsert(
          {
            provider: 'razorpay',
            reconciliation_date: new Date().toISOString().slice(0, 10),
            reference_type: 'refund',
            reference_id: gatewayRefundId,
            provider_amount_minor: Number(refundEntity?.amount || 0),
            status: 'open',
            reason: 'Refund webhook could not be matched by gateway refund id or refund_request_id note',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'provider,reconciliation_date,reference_type,reference_id' },
        );
        await supabase
          .from('payment_provider_events')
          .update({
            processing_status: 'processed',
            processed_at: new Date().toISOString(),
            error_message: 'unmatched_refund_requires_reconciliation',
          })
          .eq('id', providerEventRowId);
        return new Response(
          JSON.stringify({ received: true, matched: false, reconciliation_required: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: expectedAttempts, error: expectedAttemptError } = await supabase
        .from('refund_attempts')
        .select('id, provider_payment_id, provider_refund_id, amount_minor, status')
        .eq('refund_id', matchedRefundId)
        .eq('provider', 'razorpay')
        .order('created_at', { ascending: false })
        .limit(1);
      if (expectedAttemptError) {
        throw new Error(`refund_attempt_lookup_failed:${expectedAttemptError.message}`);
      }
      const expectedAttempt = expectedAttempts?.[0] || null;
      const providerAmountMinor = Number(refundEntity?.amount);
      const identityMismatch =
        !expectedAttempt ||
        !paymentId ||
        expectedAttempt.provider_payment_id !== paymentId ||
        !Number.isSafeInteger(providerAmountMinor) ||
        providerAmountMinor !== Number(expectedAttempt.amount_minor) ||
        (
          !!expectedAttempt.provider_refund_id &&
          expectedAttempt.provider_refund_id !== gatewayRefundId
        );

      if (identityMismatch) {
        await supabase.from('financial_reconciliation_records').upsert(
          {
            provider: 'razorpay',
            reconciliation_date: new Date().toISOString().slice(0, 10),
            reference_type: 'refund',
            reference_id: gatewayRefundId,
            internal_amount_minor: expectedAttempt?.amount_minor || null,
            provider_amount_minor: Number.isSafeInteger(providerAmountMinor)
              ? providerAmountMinor
              : null,
            status: 'open',
            reason: 'Refund webhook payment, amount, or provider refund identity did not match the recorded attempt',
            metadata: {
              refund_request_id: matchedRefundId,
              expected_payment_id: expectedAttempt?.provider_payment_id || null,
              provider_payment_id: paymentId || null,
              expected_refund_id: expectedAttempt?.provider_refund_id || null,
              provider_refund_id: gatewayRefundId,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'provider,reconciliation_date,reference_type,reference_id' },
        );
        await supabase
          .from('payment_provider_events')
          .update({
            processing_status: 'processed',
            processed_at: new Date().toISOString(),
            error_message: 'refund_identity_or_amount_mismatch_requires_reconciliation',
          })
          .eq('id', providerEventRowId);
        return new Response(
          JSON.stringify({
            received: true,
            matched: false,
            reconciliation_required: true,
            reason: 'refund_identity_or_amount_mismatch',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { error: bindRefundError } = await supabase
        .from('refund_requests')
        .update({
          gateway_refund_id: gatewayRefundId,
          gateway_status: gatewayStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchedRefundId);
      if (bindRefundError) {
        throw new Error(`refund_identity_bind_failed:${bindRefundError.message}`);
      }

      await supabase
        .from('refund_attempts')
        .update({
          provider_refund_id: gatewayRefundId,
          provider_status: gatewayStatus,
          status: event === 'refund.processed' ? 'succeeded' : 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('refund_id', matchedRefundId)
        .eq('provider', 'razorpay');

      if (event === 'refund.created') {
        console.log('[razorpay-webhook] refund created; waiting for processed', gatewayRefundId);
      } else {
      const { data: reconcileResult, error: reconcileErr } = await supabase.rpc(
        'complete_refund_by_gateway_id',
        {
          p_gateway_refund_id: gatewayRefundId,
          p_gateway_status: gatewayStatus,
          p_razorpay_payment_id: paymentId || null,
        },
      );

      if (reconcileErr) {
        console.error('[razorpay-webhook] complete_refund_by_gateway_id failed', reconcileErr);
        await supabase
          .from('payment_provider_events')
          .update({
            processing_status: 'failed',
            error_message: `refund_reconcile_failed:${reconcileErr.message}`.slice(0, 1000),
          })
          .eq('id', providerEventRowId);
        // Do not ACK success — Razorpay should retry; never leave money state via raw UPDATE
        return new Response(
          JSON.stringify({ error: 'refund_reconcile_failed', detail: reconcileErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (reconcileResult?.ok !== true) {
        await supabase
          .from('payment_provider_events')
          .update({
            processing_status: 'failed',
            error_message: `refund_reconcile_incomplete:${JSON.stringify(reconcileResult).slice(0, 700)}`,
          })
          .eq('id', providerEventRowId);
        return new Response(
          JSON.stringify({ error: 'refund_reconcile_incomplete', result: reconcileResult }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      console.log('[razorpay-webhook] refund reconciled', gatewayRefundId, reconcileResult);
      }
    }

    await supabase
      .from('payment_provider_events')
      .update({
        processing_status: 'processed',
        processed_at: new Date().toISOString(),
        error_message: null,
        locked_at: null,
        lease_expires_at: null,
      })
      .eq('id', providerEventRowId);

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Webhook error:', error);
    if (eventStore && providerEventRowId) {
      await eventStore
        .from('payment_provider_events')
        .update({
          processing_status: 'failed',
          error_message: String(error).slice(0, 1000),
          locked_at: null,
          lease_expires_at: null,
        })
        .eq('id', providerEventRowId);
    }
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
