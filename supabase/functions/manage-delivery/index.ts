import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { withAuth } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// C2: Cryptographically secure 4-digit OTP
function generateOTP(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(1000 + (arr[0] % 9000));
}

// Hash OTP with SHA-256
async function hashOTP(otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(otp);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function verifyOTP(otp: string, hash: string): Promise<boolean> {
  const computed = await hashOTP(otp);
  // Constant-time comparison to prevent timing attacks (matches verifyHMAC pattern)
  const aDecoded = atob(computed);
  const bDecoded = atob(hash);
  const aBytes = new Uint8Array(aDecoded.length);
  const bBytes = new Uint8Array(bDecoded.length);
  for (let i = 0; i < aDecoded.length; i++) aBytes[i] = aDecoded.charCodeAt(i);
  for (let i = 0; i < bDecoded.length; i++) bBytes[i] = bDecoded.charCodeAt(i);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

// C3: HMAC-SHA256 verification with constant-time comparison
async function verifyHMAC(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expectedBytes = new Uint8Array(sig);
    // Decode incoming base64 signature to bytes
    const sigDecoded = atob(signature);
    const sigBytes = new Uint8Array(sigDecoded.length);
    for (let i = 0; i < sigDecoded.length; i++) {
      sigBytes[i] = sigDecoded.charCodeAt(i);
    }
    if (expectedBytes.length !== sigBytes.length) return false;
    // Constant-time comparison to prevent timing attacks
    let diff = 0;
    for (let i = 0; i < expectedBytes.length; i++) {
      diff |= expectedBytes[i] ^ sigBytes[i];
    }
    return diff === 0;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // Service client for all operations (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Webhook doesn't require user auth
    if (action === 'webhook') {
      return await handleWebhook(req, serviceClient);
    }

    // All other actions require auth (Phase 5: centralized)
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    // Phase 2: Rate limiting for authenticated actions
    const { allowed } = await checkRateLimit(`delivery:${userId}`, 20, 60);
    if (!allowed) return rateLimitResponse(corsHeaders);

    // Phase 1 Step 3: Feature check before mutations
    if (['assign', 'update_status', 'complete'].includes(action || '')) {
      // Get user's society to check feature flag
      const { data: profile } = await serviceClient
        .from('profiles').select('society_id').eq('id', userId).single();
      if (profile?.society_id) {
        const { data: enabled } = await serviceClient.rpc(
          'is_feature_enabled_for_society',
          { _society_id: profile.society_id, _feature_key: 'delivery' }
        );
        if (enabled === false) return jsonResponse({ error: 'Delivery feature is disabled for your society' }, 403);
      }
    }

    switch (action) {
      case 'assign':
        return await handleAssign(req, serviceClient, userId);
      case 'update_status':
        return await handleUpdateStatus(req, serviceClient, userId);
      case 'complete':
        return await handleComplete(req, serviceClient, userId);
      case 'track':
        return await handleTrack(req, serviceClient, userId);
      case 'calculate_fee':
        return await handleCalculateFee(req, serviceClient, userId);
      default:
        return jsonResponse({ error: 'Invalid action' }, 400);
    }
  } catch (error) {
    console.error('manage-delivery error:', error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

// Assign a delivery partner to a pending assignment
async function handleAssign(req: Request, db: any, userId: string) {
  const body = await req.json();
  const { assignment_id, partner_id, rider_name, rider_phone } = body;

  if (!assignment_id) return jsonResponse({ error: 'assignment_id required' }, 400);

  const { data: assignment } = await db
    .from('delivery_assignments')
    .select('id, order_id, society_id, status')
    .eq('id', assignment_id)
    .single();

  if (!assignment) return jsonResponse({ error: 'Assignment not found' }, 404);
  if (assignment.status !== 'pending') return jsonResponse({ error: 'Assignment not in pending status' }, 400);

  // Bug 10 fix: Authorization — only the order's seller, a society admin, or platform admin can assign
  const { data: order } = await db.from('orders').select('seller_id').eq('id', assignment.order_id).single();
  if (!order) return jsonResponse({ error: 'Order not found' }, 404);

  const { data: sellerProfile } = await db.from('seller_profiles').select('user_id').eq('id', order.seller_id).single();
  const isSeller = sellerProfile?.user_id === userId;

  let isSocietyAdmin = false;
  if (assignment.society_id) {
    const { data: adminRow } = await db.from('society_admins').select('id').eq('society_id', assignment.society_id).eq('user_id', userId).maybeSingle();
    isSocietyAdmin = !!adminRow;
  }

  const { data: platformAdmin } = await db.from('user_roles').select('id').eq('user_id', userId).eq('role', 'admin').maybeSingle();
  const isPlatformAdmin = !!platformAdmin;

  if (!isSeller && !isSocietyAdmin && !isPlatformAdmin) {
    return jsonResponse({ error: 'Not authorized to assign delivery for this order' }, 403);
  }

  const { error } = await db
    .from('delivery_assignments')
    .update({
      partner_id: partner_id || null,
      rider_name: rider_name || null,
      rider_phone: rider_phone || null,
      status: 'assigned',
      assigned_at: new Date().toISOString(),
    })
    .eq('id', assignment_id);

  if (error) return jsonResponse({ error: error.message }, 500);

  await db.from('delivery_tracking_logs').insert({
    assignment_id,
    status: 'assigned',
    note: `Assigned to ${rider_name || 'rider'}`,
    source: 'manual',
  });

  return jsonResponse({ success: true });
}

// Update delivery status (pickup, at_gate, etc.)
async function handleUpdateStatus(req: Request, db: any, userId: string) {
  const body = await req.json();
  const { assignment_id, status, note, location_lat, location_lng } = body;

  if (!assignment_id || !status) return jsonResponse({ error: 'assignment_id and status required' }, 400);

  // DB-driven: validate status against allowed delivery transitions
  const { data: assignment } = await db
    .from('delivery_assignments')
    .select('id, order_id, society_id, status as current_status')
    .eq('id', assignment_id)
    .single();

  if (!assignment) return jsonResponse({ error: 'Assignment not found' }, 404);

  // Look up the order's transaction_type + seller's parent_group for workflow validation
  const { data: orderData } = await db
    .from('orders')
    .select('transaction_type, seller_id')
    .eq('id', assignment.order_id)
    .single();

  const txnType = orderData?.transaction_type || 'self_fulfillment';

  // Bug 1 fix: Derive parent_group from seller for accurate transition lookup
  let parentGroup = 'default';
  if (orderData?.seller_id) {
    const { data: sellerData } = await db
      .from('seller_profiles')
      .select('primary_group')
      .eq('id', orderData.seller_id)
      .single();
    if (sellerData?.primary_group) parentGroup = sellerData.primary_group;
  }

  // Bug 1 fix: Validate transition using from_status + parent_group (matching frontend logic)
  // Multi-actor: accept both 'delivery' and 'seller' actors for self-delivery workflows
  // First try specific parent_group, then fallback to 'default'
  let { data: validTransitions } = await db
    .from('category_status_transitions')
    .select('to_status')
    .eq('parent_group', parentGroup)
    .eq('transaction_type', txnType)
    .eq('from_status', assignment.current_status)
    .in('allowed_actor', ['delivery', 'seller']);

  // Fallback to default parent_group if no transitions found
  if ((!validTransitions || validTransitions.length === 0) && parentGroup !== 'default') {
    const fallback = await db
      .from('category_status_transitions')
      .select('to_status')
      .eq('parent_group', 'default')
      .eq('transaction_type', txnType)
      .eq('from_status', assignment.current_status)
      .in('allowed_actor', ['delivery', 'seller']);
    validTransitions = fallback.data;
  }

  const validStatuses = new Set((validTransitions || []).map((t: any) => t.to_status));
  // Always allow system-level statuses
  validStatuses.add('failed');
  validStatuses.add('cancelled');

  if (!validStatuses.has(status)) return jsonResponse({ error: `Invalid status: ${status}` }, 400);

  const updateData: Record<string, any> = { status };

  // Bug 3 fix: Check if the NEXT step in the workflow requires OTP — generate OTP dynamically
  const { data: nextFlowStep } = await db
    .from('category_status_flows')
    .select('requires_otp')
    .eq('transaction_type', txnType)
    .eq('parent_group', parentGroup)
    .eq('status_key', status)
    .maybeSingle();

  // Also check default parent_group for requires_otp
  let nextStepRequiresOtp = nextFlowStep?.requires_otp === true;
  if (!nextFlowStep && parentGroup !== 'default') {
    const { data: defaultStep } = await db
      .from('category_status_flows')
      .select('requires_otp')
      .eq('transaction_type', txnType)
      .eq('parent_group', 'default')
      .eq('status_key', status)
      .maybeSingle();
    nextStepRequiresOtp = defaultStep?.requires_otp === true;
  }

  // Bug 3 fix: Generate OTP when entering a status that PRECEDES an OTP-requiring step
  // OR when the current step itself requires OTP (the OTP is for the delivery confirmation)
  // We check: does any step after this one have requires_otp = true?
  let shouldGenerateOtp = false;
  {
    const { data: allFlowSteps } = await db
      .from('category_status_flows')
      .select('status_key, sort_order, requires_otp')
      .eq('transaction_type', txnType)
      .eq('parent_group', parentGroup !== 'default' ? parentGroup : 'default')
      .order('sort_order', { ascending: true });

    if (allFlowSteps && allFlowSteps.length > 0) {
      const currentStepIdx = allFlowSteps.findIndex((s: any) => s.status_key === status);
      if (currentStepIdx >= 0) {
        // Check if any subsequent step requires OTP
        const futureOtpStep = allFlowSteps.slice(currentStepIdx + 1).find((s: any) => s.requires_otp === true);
        // Generate OTP on this status if a future step needs it and we haven't generated one yet
        if (futureOtpStep) {
          // Check if OTP already exists on the assignment
          const { data: currentAssignment } = await db
            .from('delivery_assignments')
            .select('otp_hash')
            .eq('id', assignment_id)
            .single();
          if (!currentAssignment?.otp_hash) {
            shouldGenerateOtp = true;
          }
        }
      }
    }
  }

  if (status === 'picked_up') {
    updateData.pickup_at = new Date().toISOString();
  }

  // Bug 3 fix: Dynamic OTP generation based on workflow, not hardcoded status
  if (shouldGenerateOtp) {
    const otp = generateOTP();
    updateData.otp_hash = await hashOTP(otp);
    updateData.otp_expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data: order } = await db.from('orders').select('buyer_id').eq('id', assignment.order_id).single();
    if (order) {
      await db.from('notification_queue').insert({
        user_id: order.buyer_id,
        title: '🔑 Delivery OTP',
        body: `Your delivery OTP is ${otp}. Share this with the delivery partner to confirm delivery.`,
        type: 'delivery',
        reference_path: `/orders/${assignment.order_id}`,
        payload: { orderId: assignment.order_id, deliveryStatus: status },
      });

      const { data: asgn } = await db
        .from('delivery_assignments')
        .select('rider_name, rider_phone, society_id')
        .eq('id', assignment_id)
        .single();

      const { data: buyer } = await db
        .from('profiles')
        .select('id, flat_number, name')
        .eq('id', order.buyer_id)
        .single();

      if (asgn && buyer) {
        const visitorOtp = String(Math.floor(100000 + Math.random() * 900000));
        await db.from('visitor_entries').insert({
          society_id: asgn.society_id,
          resident_id: buyer.id,
          visitor_name: asgn.rider_name || 'Delivery Rider',
          visitor_phone: asgn.rider_phone || null,
          visitor_type: 'delivery',
          flat_number: buyer.flat_number,
          purpose: `Order #${assignment.order_id.slice(0, 8)} delivery`,
          expected_date: new Date().toISOString().split('T')[0],
          status: 'expected',
          is_preapproved: true,
          otp_code: visitorOtp,
          otp_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });

        await db.from('notification_queue').insert({
          user_id: buyer.id,
          title: '🏠 Delivery Rider Gate OTP',
          body: `Gate OTP for your delivery rider: ${visitorOtp}. Share this with the guard if needed.`,
          type: 'delivery',
          reference_path: `/orders/${assignment.order_id}`,
          payload: { orderId: assignment.order_id, gateOtp: visitorOtp },
        });
      }
    }
  }

  if (status === 'failed') {
    updateData.failed_reason = note || 'Delivery failed';
    updateData.attempt_count = (assignment as any).attempt_count + 1;
    updateData.failure_owner = body.failure_owner || null;
    // Bug 18 fix: Don't resurrect cancelled/completed orders
    await db.from('orders').update({ status: 'returned' })
      .eq('id', assignment.order_id)
      .neq('status', 'cancelled')
      .neq('status', 'completed')
      .neq('status', 'refunded');
  }

  if (status === 'at_gate') {
    updateData.at_gate_at = new Date().toISOString();
    const { data: asgn } = await db
      .from('delivery_assignments')
      .select('rider_name, order_id, society_id')
      .eq('id', assignment_id)
      .single();

    if (asgn) {
      const { data: order } = await db.from('orders').select('buyer_id').eq('id', asgn.order_id).single();
      if (order) {
        await db.from('notification_queue').insert({
          user_id: order.buyer_id,
          title: '🏠 Delivery Rider at Gate',
          body: `${asgn.rider_name || 'Your delivery rider'} is at the society gate. Please share your delivery OTP to confirm.`,
          type: 'delivery',
          reference_path: `/orders/${asgn.order_id}`,
          payload: { orderId: asgn.order_id, deliveryStatus: 'at_gate' },
        });
      }
    }
  }

  const { error } = await db
    .from('delivery_assignments')
    .update(updateData)
    .eq('id', assignment_id);

  if (error) return jsonResponse({ error: error.message }, 500);

  // Bug 2 fix: Sync orders.status for ALL delivery status updates (not just picked_up)
  // Skip terminal/failure statuses which have their own order update logic above
  if (!['failed', 'cancelled'].includes(status)) {
    await db.from('orders').update({ status }).eq('id', assignment.order_id);
  }

  await db.from('delivery_tracking_logs').insert({
    assignment_id,
    status,
    note: note || null,
    location_lat: location_lat || null,
    location_lng: location_lng || null,
    source: 'manual',
  });

  return jsonResponse({ success: true });
}

// Complete delivery with OTP verification
async function handleComplete(req: Request, db: any, userId: string) {
  const body = await req.json();
  const { assignment_id, otp } = body;

  if (!assignment_id || !otp) return jsonResponse({ error: 'assignment_id and otp required' }, 400);

  const { data: assignment } = await db
    .from('delivery_assignments')
    .select('id, order_id, otp_hash, otp_expires_at, status, otp_attempt_count, max_otp_attempts, rider_id, partner_id')
    .eq('id', assignment_id)
    .single();

  if (!assignment) return jsonResponse({ error: 'Assignment not found' }, 404);
  // Bug 1 fix: Validate deliverable status from DB (is_transit or delivery actor) instead of hardcoded list
  const { data: orderForComplete } = await db.from('orders').select('transaction_type, seller_id').eq('id', assignment.order_id).single();
  const completeTxnType = orderForComplete?.transaction_type || 'self_fulfillment';
  const { data: transitCheck } = await db
    .from('category_status_flows')
    .select('status_key')
    .eq('transaction_type', completeTxnType)
    .in('status_key', [assignment.status])
    .or('is_transit.eq.true,actor.eq.delivery')
    .maybeSingle();

  if (!transitCheck) {
    return jsonResponse({ error: 'Assignment not in deliverable status' }, 400);
  }

  // Bug 11 fix: Authorization — only the assigned rider, seller, or buyer can complete
  const { data: order } = await db.from('orders').select('seller_id, buyer_id').eq('id', assignment.order_id).single();
  if (!order) return jsonResponse({ error: 'Order not found' }, 404);

  const { data: sellerProfile } = await db.from('seller_profiles').select('user_id').eq('id', order.seller_id).single();
  const isSeller = sellerProfile?.user_id === userId;
  const isBuyer = order.buyer_id === userId;

  // Check if caller is the assigned rider (via delivery_partner_pool.user_id)
  let isAssignedRider = false;
  if (assignment.rider_id) {
    const { data: rider } = await db.from('delivery_partner_pool').select('user_id').eq('id', assignment.rider_id).maybeSingle();
    isAssignedRider = rider?.user_id === userId;
  }

  if (!isSeller && !isBuyer && !isAssignedRider) {
    return jsonResponse({ error: 'Not authorized to complete this delivery' }, 403);
  }

  // OTP lockout check
  if (assignment.otp_attempt_count >= assignment.max_otp_attempts) {
    return jsonResponse({ error: 'OTP attempts exhausted. Delivery locked.' }, 423);
  }

  if (!assignment.otp_hash) return jsonResponse({ error: 'No OTP set for this delivery' }, 400);

  if (assignment.otp_expires_at && new Date(assignment.otp_expires_at) < new Date()) {
    return jsonResponse({ error: 'OTP has expired' }, 400);
  }

  // Increment attempt count before verification
  await db
    .from('delivery_assignments')
    .update({ otp_attempt_count: assignment.otp_attempt_count + 1 })
    .eq('id', assignment_id);

  const isValid = await verifyOTP(otp, assignment.otp_hash);
  if (!isValid) return jsonResponse({ error: 'Invalid OTP' }, 400);

  // Use dedicated service-level RPC that sets app.otp_verified flag atomically
  // then updates both delivery_assignments and orders in a single transaction
  const { error: completeError } = await db.rpc('service_complete_delivery', {
    _assignment_id: assignment_id,
    _order_id: assignment.order_id,
  });

  if (completeError) return jsonResponse({ error: completeError.message }, 500);

  await db.from('delivery_tracking_logs').insert({
    assignment_id,
    status: 'delivered',
    note: 'Delivery confirmed via OTP',
    source: 'system',
  });

  return jsonResponse({ success: true });
}

// Track delivery status
async function handleTrack(_req: Request, db: any, userId: string) {
  const url = new URL(_req.url);
  const orderId = url.searchParams.get('order_id');

  if (!orderId) return jsonResponse({ error: 'order_id required' }, 400);

  const { data: assignment } = await db
    .from('delivery_assignments')
    .select('id, status, rider_name, rider_phone, rider_photo_url, pickup_at, delivered_at, failed_reason, attempt_count, created_at')
    .eq('order_id', orderId)
    .single();

  if (!assignment) return jsonResponse({ error: 'No delivery assignment found' }, 404);

  const { data: logs } = await db
    .from('delivery_tracking_logs')
    .select('status, note, location_lat, location_lng, source, created_at')
    .eq('assignment_id', assignment.id)
    .order('created_at', { ascending: true });

  return jsonResponse({ assignment, tracking_logs: logs || [] });
}

// Phase 3: Handle 3PL webhooks with signature verification
async function handleWebhook(req: Request, db: any) {
  // Rate limit webhooks: 60/min per IP
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { allowed } = await checkRateLimit(`webhook:${clientIp}`, 60, 60);
  if (!allowed) return rateLimitResponse(corsHeaders);

  const rawBody = await req.text();
  const signature = req.headers.get('x-webhook-signature');

  // Get 3PL webhook secret from system_settings
  const { data: setting } = await db
    .from('system_settings')
    .select('value')
    .eq('key', '3pl_webhook_secret')
    .maybeSingle();

  if (setting?.value) {
    if (!signature) {
      return jsonResponse({ error: 'Missing webhook signature' }, 401);
    }
    const isValid = await verifyHMAC(rawBody, signature, setting.value);
    if (!isValid) {
      // Log rejected webhook
      await db.from('audit_log').insert({
        action: 'webhook_signature_invalid',
        target_type: 'delivery_webhook',
        metadata: { ip: clientIp },
      }).then(() => {}, () => {});
      return jsonResponse({ error: 'Invalid webhook signature' }, 401);
    }
  } else {
    // DELIVERY-01 FIX: Reject webhooks entirely when no secret is configured
    // This prevents unauthenticated delivery status manipulation in production
    console.error('3PL webhook secret not configured — rejecting webhook');
    return jsonResponse({ error: 'Webhook authentication not configured' }, 503);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { external_tracking_id, status, rider_name, rider_phone, location_lat, location_lng } = body;

  if (!external_tracking_id || !status) {
    return jsonResponse({ error: 'external_tracking_id and status required' }, 400);
  }

  const { data: assignment } = await db
    .from('delivery_assignments')
    .select('id, order_id')
    .eq('external_tracking_id', external_tracking_id)
    .single();

  if (!assignment) return jsonResponse({ error: 'Assignment not found' }, 404);

  const updateData: Record<string, any> = {};
  if (rider_name) updateData.rider_name = rider_name;
  if (rider_phone) updateData.rider_phone = rider_phone;

  // Bug 12 fix: Map 3PL 'delivered' to 'at_gate' — require OTP for final confirmation
  const statusMap: Record<string, string> = {
    'assigned': 'assigned',
    'picked_up': 'picked_up',
    'in_transit': 'picked_up',
    'arrived': 'at_gate',
    'delivered': 'at_gate', // Intentionally mapped to at_gate — OTP still required
    'failed': 'failed',
    'cancelled': 'cancelled',
  };

  const internalStatus = statusMap[status];
  if (internalStatus) {
    updateData.status = internalStatus;
    if (internalStatus === 'picked_up') updateData.pickup_at = new Date().toISOString();
    if (internalStatus === 'at_gate') updateData.at_gate_at = new Date().toISOString();
  }

  if (Object.keys(updateData).length > 0) {
    await db.from('delivery_assignments').update(updateData).eq('id', assignment.id);
  }

  await db.from('delivery_tracking_logs').insert({
    assignment_id: assignment.id,
    status: internalStatus || status,
    location_lat: location_lat || null,
    location_lng: location_lng || null,
    note: `3PL status: ${status}`,
    source: '3pl_webhook',
  });

  return jsonResponse({ success: true });
}

// Calculate delivery fee based on society config
// Bug 20 fix: Hide internal margin/payout from non-admin/non-seller users
async function handleCalculateFee(req: Request, db: any, userId: string) {
  const url = new URL(req.url);
  const orderValue = parseFloat(url.searchParams.get('order_value') || '0');

  const { data: settingsRows } = await db
    .from('system_settings')
    .select('key, value')
    .in('key', ['base_delivery_fee', 'free_delivery_threshold']);

  const settingsMap: Record<string, string> = {};
  for (const row of settingsRows || []) {
    if (row.key && row.value) settingsMap[row.key] = row.value;
  }

  const baseFee = settingsMap.base_delivery_fee != null ? parseInt(settingsMap.base_delivery_fee, 10) : 20;
  const freeThreshold = settingsMap.free_delivery_threshold != null ? parseInt(settingsMap.free_delivery_threshold, 10) : 500;

  // Check if caller is a seller or admin (allowed to see margins)
  const { data: sellerRow } = await db.from('seller_profiles').select('id').eq('user_id', userId).maybeSingle();
  const { data: adminRow } = await db.from('user_roles').select('id').eq('user_id', userId).eq('role', 'admin').maybeSingle();
  const showInternals = !!sellerRow || !!adminRow;

  if (orderValue >= freeThreshold) {
    const resp: Record<string, any> = { delivery_fee: 0, free_delivery: true };
    if (showInternals) { resp.partner_payout = 0; resp.platform_margin = 0; }
    return jsonResponse(resp);
  }

  const deliveryFee = baseFee;
  const partnerPayout = Math.round(deliveryFee * 0.7);
  const platformMargin = deliveryFee - partnerPayout;

  const resp: Record<string, any> = { delivery_fee: deliveryFee, free_delivery: false };
  if (showInternals) { resp.partner_payout = partnerPayout; resp.platform_margin = platformMargin; }
  return jsonResponse(resp);
}
