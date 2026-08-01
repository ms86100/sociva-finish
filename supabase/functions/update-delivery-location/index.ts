import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** Haversine distance in meters */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Default proximity thresholds — overridden by DB values */
const DEFAULT_PROXIMITY = {
  at_doorstep: 50,
  arriving: 200,
  nearby: 500,
};

async function loadProximityThresholds(
  supabase: ReturnType<typeof createClient>,
): Promise<typeof DEFAULT_PROXIMITY> {
  try {
    const { data } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', ['arrival_doorstep_distance_meters', 'arrival_overlay_distance_meters', 'proximity_nearby_distance_meters']);
    if (!data || data.length === 0) return DEFAULT_PROXIMITY;
    const map: Record<string, string> = {};
    for (const r of data) if (r.key && r.value) map[r.key] = r.value;
    return {
      at_doorstep: Number(map.arrival_doorstep_distance_meters) || DEFAULT_PROXIMITY.at_doorstep,
      arriving: Number(map.arrival_overlay_distance_meters) || DEFAULT_PROXIMITY.arriving,
      nearby: Number(map.proximity_nearby_distance_meters) || DEFAULT_PROXIMITY.nearby,
    };
  } catch {
    return DEFAULT_PROXIMITY;
  }
}

function getProximity(distanceMeters: number, thresholds: typeof DEFAULT_PROXIMITY): 'at_doorstep' | 'arriving' | 'nearby' | 'en_route' {
  if (distanceMeters < thresholds.at_doorstep) return 'at_doorstep';
  if (distanceMeters < thresholds.arriving) return 'arriving';
  if (distanceMeters < thresholds.nearby) return 'nearby';
  return 'en_route';
}

/** Load terminal statuses from category_status_flows — DB-driven, no hardcoding */
async function loadTerminalStatuses(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  const FALLBACK = new Set(['delivered', 'failed', 'cancelled']);
  try {
    // AUDIT FIX: removed hardcoded transaction_type filter — include all workflow types
    const { data } = await supabase
      .from('category_status_flows')
      .select('status_key')
      .eq('is_terminal', true);
    if (data && data.length > 0) {
      return new Set(data.map((r: { status_key: string }) => r.status_key));
    }
  } catch { /* fall through */ }
  return FALLBACK;
}

/** Load transit statuses from system_settings — single source of truth */
async function loadTransitStatuses(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  const FALLBACK = new Set(['picked_up', 'on_the_way', 'at_gate']);
  try {
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'transit_statuses')
      .maybeSingle();
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
    }
  } catch { /* fall through */ }
  return FALLBACK;
}

function calculateEta(distanceMeters: number, speedKmh: number | null, accuracyMeters: number | null, historicalAvgMin: number | null = null): { eta: number | null; skipUpdate: boolean } {
  if (accuracyMeters != null && accuracyMeters > 100) {
    return { eta: null, skipUpdate: true };
  }
  const speed = speedKmh ?? 0;
  if (speed < 2 && distanceMeters < 200) {
    return { eta: 1, skipUpdate: false };
  }
  const effectiveSpeed = speed > 2 ? speed : 15;
  const roadFactor = 1.3;
  const distKm = (distanceMeters * roadFactor) / 1000;
  let etaMin = Math.max(1, Math.round((distKm / effectiveSpeed) * 60));

  if (historicalAvgMin != null && historicalAvgMin > 0 && speed < 2) {
    etaMin = Math.max(1, Math.round((etaMin + historicalAvgMin) / 2));
  }

  return { eta: etaMin, skipUpdate: false };
}

function hasSignificantHeadingChange(prevHeading: number | null, currentHeading: number | null): boolean {
  if (prevHeading == null || currentHeading == null) return false;
  let diff = Math.abs(currentHeading - prevHeading);
  if (diff > 180) diff = 360 - diff;
  return diff > 90;
}

// ═══ Live Activity delta-based push constants ═══
const LA_THROTTLE_FLOOR_MS = 15_000;
const LA_DISTANCE_DELTA_M = 50;
const LA_ETA_DELTA_MIN = 1;
const LA_STALE_RETRY_MS = 60_000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const fnStartMs = Date.now();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // Bug 13 fix: fallback to getUser if getClaims doesn't exist
    let callerId: string;
    if (typeof authClient.auth.getClaims === 'function') {
      const { data: claimsData, error: authError } = await authClient.auth.getClaims(token);
      if (authError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerId = claimsData.claims.sub as string;
    } else {
      const { data: userData, error: authError } = await authClient.auth.getUser(token);
      if (authError || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerId = userData.user.id;
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { assignment_id, latitude, longitude, speed_kmh, heading, accuracy_meters } = await req.json();

    if (!assignment_id || latitude == null || longitude == null) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load terminal statuses from DB (single request scope cache)
    const [terminalStatuses, transitStatusesForChecks] = await Promise.all([
      loadTerminalStatuses(supabase),
      loadTransitStatuses(supabase),
    ]);

    // Get assignment
    const { data: assignment, error: aErr } = await supabase
      .from('delivery_assignments')
      .select('id, status, order_id, society_id, partner_id, rider_id, last_location_at, stalled_notified, eta_minutes, last_location_lat, last_location_lng, rider_name')
      .eq('id', assignment_id)
      .single();

    if (aErr || !assignment) {
      return new Response(JSON.stringify({ error: 'Assignment not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (terminalStatuses.has(assignment.status)) {
      // Return 200 with a terminal flag so the client stops gracefully
      // without treating it as an error (prevents console errors for in-flight requests)
      return new Response(JSON.stringify({ terminal: true, message: 'Delivery is no longer active' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══ AUTH CHECK ═══
    let isAuthorized = false;

    if (assignment.rider_id) {
      const { data: poolRider } = await supabase
        .from('delivery_partner_pool')
        .select('user_id')
        .eq('id', assignment.rider_id)
        .single();
      if (poolRider?.user_id === callerId) isAuthorized = true;
    }

    if (!isAuthorized) {
      const { data: orderData } = await supabase
        .from('orders')
        .select('seller_id, delivery_handled_by')
        .eq('id', assignment.order_id)
        .single();

      if (orderData) {
        const { data: sellerProfile } = await supabase
          .from('seller_profiles')
          .select('user_id')
          .eq('id', orderData.seller_id)
          .single();
        if (sellerProfile?.user_id === callerId) isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Forbidden: not assigned rider or seller' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Bug 19 fix: server-side rate limit — reject if last update was <2s ago
    if (assignment.last_location_at) {
      const lastAt = new Date(assignment.last_location_at).getTime();
      if (Date.now() - lastAt < 2000) {
        return new Response(JSON.stringify({ error: 'Rate limited', retry_after_ms: 2000 }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Insert location record (Bug 3 fix: use assignment.partner_id when available)
    const { error: locErr } = await supabase
      .from('delivery_locations')
      .insert({
        assignment_id,
        partner_id: assignment.partner_id || callerId,
        latitude, longitude, speed_kmh, heading, accuracy_meters,
      });

    if (locErr) console.error('Error inserting location:', locErr);

    // Get destination coordinates and seller info
    const { data: orderForDest } = await supabase
      .from('orders')
      .select('delivery_lat, delivery_lng, buyer_id, seller_id')
      .eq('id', assignment.order_id)
      .single();

    let destLat = orderForDest?.delivery_lat;
    let destLng = orderForDest?.delivery_lng;
    const buyerId = orderForDest?.buyer_id;
    const sellerId = orderForDest?.seller_id;

    if (!destLat || !destLng) {
      const { data: society } = await supabase
        .from('societies')
        .select('latitude, longitude')
        .eq('id', assignment.society_id)
        .single();
      destLat = society?.latitude;
      destLng = society?.longitude;
    }

    let distanceMeters: number | null = null;
    let etaMinutes: number | null = null;
    let proximity: string = 'en_route';
    let skipEtaUpdate = false;

    const proximityThresholds = await loadProximityThresholds(supabase);

    if (destLat && destLng) {
      distanceMeters = Math.round(haversineDistance(latitude, longitude, destLat, destLng));
      proximity = getProximity(distanceMeters, proximityThresholds);

      let historicalAvgMin: number | null = null;
      if ((speed_kmh == null || speed_kmh < 2) && sellerId) {
        const currentHour = new Date().getUTCHours();
        const { data: stats } = await supabase
          .from('delivery_time_stats')
          .select('avg_delivery_minutes')
          .eq('seller_id', sellerId)
          .eq('society_id', assignment.society_id)
          .eq('time_bucket', currentHour)
          .maybeSingle();
        if (stats?.avg_delivery_minutes) {
          historicalAvgMin = Number(stats.avg_delivery_minutes);
        }
      }

      const etaResult = calculateEta(distanceMeters, speed_kmh, accuracy_meters, historicalAvgMin);
      skipEtaUpdate = etaResult.skipUpdate;
      if (!skipEtaUpdate) etaMinutes = etaResult.eta;
    }

    // Build update payload
    const now = new Date().toISOString();

    // Bug 5: Reset stalled_notified when meaningful movement resumes (>100m since last known)
    let resetStalled = false;
    if (assignment.stalled_notified && assignment.last_location_lat && assignment.last_location_lng) {
      const moveDelta = haversineDistance(assignment.last_location_lat, assignment.last_location_lng, latitude, longitude);
      if (moveDelta > 100) resetStalled = true;
    }

    const updateData: Record<string, unknown> = {
      last_location_lat: latitude,
      last_location_lng: longitude,
      last_location_at: now,
      distance_meters: distanceMeters,
      proximity_status: proximity,
      ...(resetStalled ? { stalled_notified: false } : {}),
    };
    if (!skipEtaUpdate && etaMinutes != null) {
      updateData.eta_minutes = etaMinutes;
    }

    const dbStartMs = Date.now();
    await supabase
      .from('delivery_assignments')
      .update(updateData)
      .eq('id', assignment_id);
    const dbMs = Date.now() - dbStartMs;

    // ═══ PHASE A: First GPS update after picked_up → en_route notification ═══
    // Guard: Only send when the ORDER (not just assignment) is in a transit stage AND is at least 2 min old.
    // This prevents false "on the way" alerts for seller-delivery where seller IS the rider and is already nearby.
    if (assignment.status === 'picked_up' && !assignment.last_location_at && buyerId) {
      const { data: orderForEnRoute } = await supabase
        .from('orders')
        .select('status, created_at')
        .eq('id', assignment.order_id)
        .single();

      const enRouteOrderStatus = orderForEnRoute?.status ?? null;
      const enRouteOrderAgeMs = orderForEnRoute?.created_at ? Date.now() - new Date(orderForEnRoute.created_at).getTime() : 0;
      const isEnRouteOrderInTransit = enRouteOrderStatus && transitStatusesForChecks.has(enRouteOrderStatus);
      const isEnRouteOrderOldEnough = enRouteOrderAgeMs > 2 * 60 * 1000;

      if (isEnRouteOrderInTransit && isEnRouteOrderOldEnough) {
        const { count } = await supabase
          .from('notification_queue')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', buyerId)
          .eq('type', 'delivery_en_route')
          .eq('reference_path', `/orders/${assignment.order_id}`);

        if (!count || count === 0) {
          await supabase.from('notification_queue').insert({
            user_id: buyerId,
            title: '🛵 Your order is on the way!',
            body: 'Your delivery partner has picked up your order and is heading to you.',
            type: 'delivery_en_route',
            reference_path: `/orders/${assignment.order_id}`,
            payload: {
              type: 'delivery_en_route',
              entity_type: 'order',
              entity_id: assignment.order_id,
              workflow_status: 'picked_up',
              action: 'View Tracking',
            },
          });
        }
      }
    }

    // ═══ STALE DETECTION ═══
    if (
      assignment.last_location_at &&
      !assignment.stalled_notified &&
      transitStatusesForChecks.has(assignment.status)
    ) {
      const lastAt = new Date(assignment.last_location_at).getTime();
      const staleDiffMs = Date.now() - lastAt;
      if (staleDiffMs > 3 * 60 * 1000 && buyerId) {
        await supabase.from('notification_queue').insert({
          user_id: buyerId,
          title: '⏳ Delivery may be delayed',
          body: 'Your delivery partner appears to have paused. We\'re keeping an eye on it.',
          type: 'delivery_stalled',
          reference_path: `/orders/${assignment.order_id}`,
          payload: {
            type: 'delivery_stalled',
            entity_type: 'order',
            entity_id: assignment.order_id,
            workflow_status: assignment.status,
            action: 'View Tracking',
          },
        });

        await supabase
          .from('delivery_assignments')
          .update({ stalled_notified: true })
          .eq('id', assignment_id);
      }
    }

    // ═══ Smart Delay Detection ═══
    if (distanceMeters !== null && buyerId && transitStatusesForChecks.has(assignment.status)) {
      const prevEta = assignment.eta_minutes;
      const etaSpike = prevEta != null && etaMinutes != null && (etaMinutes - prevEta) > 5;

      let headingReversal = false;
      if (assignment.last_location_lat && assignment.last_location_lng && heading != null) {
        const prevBearing = Math.atan2(
          longitude - assignment.last_location_lng,
          latitude - assignment.last_location_lat
        ) * (180 / Math.PI);
        headingReversal = hasSignificantHeadingChange(prevBearing, heading);
      }

      if (etaSpike || headingReversal) {
        const thirtySecsAgoDelay = new Date(Date.now() - 30_000).toISOString();
        const { count: delayCount } = await supabase
          .from('notification_queue')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', buyerId)
          .eq('type', 'delivery_delayed')
          .eq('reference_path', `/orders/${assignment.order_id}`)
          .gte('created_at', thirtySecsAgoDelay);

        if (!delayCount || delayCount === 0) {
          const reason = etaSpike ? 'Traffic or route change detected.' : 'Your delivery partner may have taken a different route.';
          await supabase.from('notification_queue').insert({
            user_id: buyerId,
            title: '🔄 Delivery slightly delayed',
            body: `${reason} Updated ETA: ${etaMinutes ?? '—'} min.`,
            type: 'delivery_delayed',
            reference_path: `/orders/${assignment.order_id}`,
            payload: {
              type: 'delivery_delayed',
              entity_type: 'order',
              entity_id: assignment.order_id,
              workflow_status: assignment.status,
              action: 'View Tracking',
              eta: etaMinutes,
              distance: distanceMeters,
            },
          });
        }
      }
    }

    // ═══ Proximity notifications ═══
    // Guard: Only send proximity alerts when the ORDER (not just assignment) is in an actual transit stage
    // This prevents false alerts for seller-delivery where seller is already near the buyer at acceptance
    let orderStatusForProximity: string | null = null;
    if (distanceMeters !== null && buyerId && transitStatusesForChecks.has(assignment.status)) {
      // Fetch the actual order status to gate proximity notifications
      const { data: orderForStatus } = await supabase
        .from('orders')
        .select('status, created_at')
        .eq('id', assignment.order_id)
        .single();
      orderStatusForProximity = orderForStatus?.status ?? null;

      // Only fire if the ORDER itself is in a transit stage AND order is at least 2 min old
      const orderAgeMs = orderForStatus?.created_at ? Date.now() - new Date(orderForStatus.created_at).getTime() : Infinity;
      const isOrderInTransit = orderStatusForProximity && transitStatusesForChecks.has(orderStatusForProximity);
      const isOrderOldEnough = orderAgeMs > 2 * 60 * 1000;

      if (isOrderInTransit && isOrderOldEnough) {
        let vehicleType: string | null = null;
        if (assignment.rider_id) {
          const { data: riderInfo } = await supabase
            .from('delivery_partner_pool')
            .select('vehicle_type')
            .eq('id', assignment.rider_id)
            .single();
          vehicleType = riderInfo?.vehicle_type ?? null;
        }

        // MUTUALLY EXCLUSIVE tiers: <200m = imminent ONLY, 200-500m = nearby ONLY
        // Dedup enforced by partial unique index uq_proximity_notif_per_order
        if (distanceMeters < 200) {
          // Mark any existing pending proximity_imminent as processed to open the unique slot
          await supabase
            .from('notification_queue')
            .update({ status: 'sent' })
            .eq('user_id', buyerId)
            .eq('type', 'delivery_proximity_imminent')
            .eq('reference_path', `/orders/${assignment.order_id}`)
            .eq('status', 'pending');

          const { error: insertErr } = await supabase.from('notification_queue').insert({
            user_id: buyerId,
            title: '🏃 Driver arriving now!',
            body: 'Your delivery partner is almost at your doorstep. Please get ready to receive your order.',
            type: 'delivery_proximity_imminent',
            reference_path: `/orders/${assignment.order_id}`,
            payload: {
              type: 'delivery_proximity_imminent',
              entity_type: 'order',
              entity_id: assignment.order_id,
              workflow_status: 'at_doorstep',
              action: 'View Tracking',
              distance: distanceMeters,
              eta: etaMinutes,
              driver_name: assignment.rider_name ?? null,
              vehicle_type: vehicleType,
            },
          });
          if (insertErr && !insertErr.message?.includes('duplicate key')) {
            console.error('Proximity imminent insert error:', insertErr);
          }
        } else if (distanceMeters < 500) {
          await supabase
            .from('notification_queue')
            .update({ status: 'sent' })
            .eq('user_id', buyerId)
            .eq('type', 'delivery_proximity')
            .eq('reference_path', `/orders/${assignment.order_id}`)
            .eq('status', 'pending');

          const { error: insertErr } = await supabase.from('notification_queue').insert({
            user_id: buyerId,
            title: '📍 Almost there!',
            body: 'Your delivery partner is nearby and arriving soon!',
            type: 'delivery_proximity',
            reference_path: `/orders/${assignment.order_id}`,
            payload: {
              type: 'delivery_proximity',
              entity_type: 'order',
              entity_id: assignment.order_id,
              workflow_status: 'arriving',
              action: 'View Tracking',
              distance: distanceMeters,
              eta: etaMinutes,
              driver_name: assignment.rider_name ?? null,
              vehicle_type: vehicleType,
            },
          });
          if (insertErr && !insertErr.message?.includes('duplicate key')) {
            console.error('Proximity insert error:', insertErr);
          }
        }
      }
    }

    // ═══ Live Activity delta-based APNs push ═══
    let laPushMs: number | null = null;
    // DB-driven transit check — load transit_statuses_la from system_settings
    const { data: transitSetting } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'transit_statuses_la')
      .maybeSingle();
    const transitStatuses: string[] = transitSetting?.value ? (() => { try { return JSON.parse(transitSetting.value); } catch { return ['picked_up', 'on_the_way', 'at_gate']; } })() : ['picked_up', 'on_the_way', 'at_gate'];

    if (transitStatuses.includes(assignment.status)) {
      try {
        const { data: laToken } = await supabase
          .from('live_activity_tokens')
          .select('id, push_token, updated_at, last_pushed_eta, last_pushed_distance')
          .eq('order_id', assignment.order_id)
          .maybeSingle();

        if (laToken?.push_token) {
          const lastPushedAt = laToken.updated_at ? new Date(laToken.updated_at).getTime() : 0;
          const timeSinceLastPush = Date.now() - lastPushedAt;
          const prevPushedEta = laToken.last_pushed_eta;
          const prevPushedDist = laToken.last_pushed_distance;

          // Delta checks
          const distanceDelta = (prevPushedDist != null && distanceMeters != null)
            ? Math.abs(distanceMeters - prevPushedDist)
            : Infinity;
          const etaDelta = (prevPushedEta != null && etaMinutes != null)
            ? Math.abs(etaMinutes - prevPushedEta)
            : Infinity;
          const proximityChanged = false; // proximity_status change tracked above

          const isStale = timeSinceLastPush > LA_STALE_RETRY_MS;
          const hasMeaningfulChange = distanceDelta > LA_DISTANCE_DELTA_M || etaDelta >= LA_ETA_DELTA_MIN;
          const throttleOk = timeSinceLastPush >= LA_THROTTLE_FLOOR_MS;

          if (throttleOk && (hasMeaningfulChange || isStale)) {
            const laPushStart = Date.now();

            // Fetch seller info for the push
            let sellerName: string | null = null;
            let sellerLogoUrl: string | null = null;
            if (sellerId) {
              const { data: sp } = await supabase
                .from('seller_profiles')
                .select('business_name, profile_image_url')
                .eq('id', sellerId)
                .single();
              sellerName = sp?.business_name ?? null;
              sellerLogoUrl = sp?.profile_image_url ?? null;
            }

            // Invoke APNs push
            const pushResp = await supabase.functions.invoke('update-live-activity-apns', {
              body: {
                order_id: assignment.order_id,
                status: assignment.status,
                push_token: laToken.push_token,
                seller_name: sellerName,
                seller_logo_url: sellerLogoUrl,
                initial_eta_minutes: etaMinutes,
              },
            });

            laPushMs = Date.now() - laPushStart;

            // Update push state in DB
            if (!pushResp.error) {
              await supabase
                .from('live_activity_tokens')
                .update({
                  updated_at: new Date().toISOString(),
                  last_pushed_eta: etaMinutes ?? prevPushedEta,
                  last_pushed_distance: distanceMeters ?? prevPushedDist,
                })
                .eq('id', laToken.id);
            }

            console.log(`[Location] LA push for order=${assignment.order_id} distDelta=${Math.round(distanceDelta)}m etaDelta=${etaDelta}min pushMs=${laPushMs}`);
          }
        }
      } catch (laErr) {
        console.error('[Location] LA push error:', laErr);
      }
    }

    const totalMs = Date.now() - fnStartMs;
    console.log(`[Location] assignment=${assignment_id} db=${dbMs}ms total=${totalMs}ms${laPushMs != null ? ` la_push=${laPushMs}ms` : ''}`);

    return new Response(JSON.stringify({
      success: true,
      eta_minutes: etaMinutes,
      distance_meters: distanceMeters,
      proximity,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('update-delivery-location error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
