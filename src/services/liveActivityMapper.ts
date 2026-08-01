// @ts-nocheck
import type { LiveActivityData } from '@/plugins/live-activity/definitions';
import { getTrackingConfigSync } from '@/services/trackingConfig';

/** Status flow entry from category_status_flows table */
export interface StatusFlowEntry {
  status_key: string;
  display_label: string;
  sort_order: number;
  buyer_hint?: string | null;
}

/**
 * Derives progress_percent from sort_order within the status flow.
 * Maps sort_order range [min..max] to [0.05..1.0].
 */
function deriveProgressPercent(
  statusKey: string,
  flowMap: Map<string, StatusFlowEntry>,
): number | null {
  const entry = flowMap.get(statusKey);
  if (!entry) return null;

  const sortOrders = Array.from(flowMap.values()).map(e => e.sort_order);
  const minSort = Math.min(...sortOrders);
  const maxSort = Math.max(...sortOrders);
  if (maxSort === minSort) return 0.5;

  return 0.05 + ((entry.sort_order - minSort) / (maxSort - minSort)) * 0.95;
}

/**
 * Maps order status + delivery info into a meaningful progress stage string.
 * Uses DB-backed display_label when available.
 * Transit statuses come from system_settings via trackingConfig.
 */
function mapProgressStage(
  status: string,
  flowMap: Map<string, StatusFlowEntry>,
  delivery?: {
    eta_minutes?: number | null;
    rider_name?: string | null;
  } | null,
): string | null {
  const config = getTrackingConfigSync();
  const TRANSIT_STATUSES = new Set(config.transit_statuses_la);

  if (TRANSIT_STATUSES.has(status) && delivery) {
    const parts: string[] = [];
    if (delivery.rider_name) parts.push(delivery.rider_name);
    if (delivery.eta_minutes != null) parts.push(`ETA ${delivery.eta_minutes} min`);
    if (parts.length > 0) return parts.join(' · ');
  }

  // Use DB-backed label
  const entry = flowMap.get(status);
  if (entry?.display_label) return entry.display_label;

  return null;
}

/**
 * Derives a short order ID from the full UUID, e.g. "#7838".
 */
function deriveOrderShortId(orderId: string): string {
  const clean = orderId.replace(/-/g, '');
  const last4 = clean.slice(-4).toUpperCase();
  return `#${last4}`;
}

/**
 * Builds a LiveActivityData payload from an order row, optional
 * delivery assignment data, and DB-backed status flow entries.
 */
export function buildLiveActivityData(
  order: {
    id: string;
    status: string;
  },
  delivery?: {
    eta_minutes?: number | null;
    distance_meters?: number | null;
    rider_name?: string | null;
    vehicle_type?: string | null;
  } | null,
  sellerName?: string | null,
  itemCount?: number | null,
  statusFlowEntries?: StatusFlowEntry[],
  sellerLogoUrl?: string | null,
  initialEtaMinutes?: number | null,
): LiveActivityData {
  const config = getTrackingConfigSync();
  const distanceKm = delivery?.distance_meters != null
    ? delivery.distance_meters / 1000
    : null;

  // Build flow map from DB entries
  const flowMap = new Map<string, StatusFlowEntry>();
  if (statusFlowEntries) {
    for (const entry of statusFlowEntries) {
      flowMap.set(entry.status_key, entry);
    }
  }

  // Derive progress from DB sort_order
  let progressPercent = deriveProgressPercent(order.status, flowMap);

  // ETA-based and GPS-based progress during transit — fully DB-driven via system_settings
  const transitSet = new Set(config.transit_statuses_la);
  const isTransit = transitSet.has(order.status);
  if (isTransit) {
    // Prefer ETA-based progress when available — gives a meaningful countdown
    if (delivery?.eta_minutes != null && delivery.eta_minutes >= 0) {
      // Bug 19: Use dynamic MAX_ETA from initial ETA or default to 15 for short deliveries
      const MAX_ETA = initialEtaMinutes && initialEtaMinutes > 5 ? initialEtaMinutes : 15;
      const ratio = Math.min(delivery.eta_minutes / MAX_ETA, 1);
      progressPercent = Math.max(0.1, Math.min(0.95, 1 - ratio));
    } else if (distanceKm != null && distanceKm >= 0) {
      // Fallback to distance-based progress
      const ratio = Math.min(distanceKm / config.max_delivery_distance_km, 1);
      progressPercent = Math.max(0.5, 0.95 - ratio * 0.45);
    }
  }

  return {
    entity_type: 'order',
    entity_id: order.id,
    workflow_status: order.status,
    eta_minutes: delivery?.eta_minutes ?? null,
    driver_distance: distanceKm,
    driver_name: delivery?.rider_name ?? null,
    vehicle_type: delivery?.vehicle_type ?? null,
    progress_stage: mapProgressStage(order.status, flowMap, delivery),
    progress_percent: progressPercent,
    seller_name: sellerName ?? null,
    item_count: itemCount ?? null,
    order_short_id: deriveOrderShortId(order.id),
    seller_logo_url: sellerLogoUrl ?? null,
  };
}
