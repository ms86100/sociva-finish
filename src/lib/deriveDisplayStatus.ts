// @ts-nocheck
/**
 * Derives a single human-readable display status from internal workflow state.
 * This is the presentation layer — no DB changes, purely computed.
 */

export interface DisplayStatusResult {
  /** Single sentence to show the user */
  text: string;
  /** Short ETA text like "25 min" or null */
  etaText: string | null;
  /** Delay flag */
  etaFlag: 'on_time' | 'slight_delay' | 'delayed' | null;
  /** Progress 0-100 for the activity card */
  progressPercent: number;
  /** Which phase: pre_transit, transit, terminal */
  phase: 'placed' | 'preparing' | 'ready' | 'transit' | 'delivered' | 'cancelled';
  /** Lucide icon name for the phase */
  icon: string;
  /** Icon accent color class (tailwind) */
  iconColor: string;
  /** @deprecated Use icon instead */
  emoji: string;
}

interface FlowStep {
  status_key: string;
  is_transit?: boolean;
  is_terminal?: boolean;
  is_success?: boolean;
  sort_order?: number;
  display_label?: string;
  buyer_display_label?: string;
  seller_display_label?: string;
}

interface DeriveOptions {
  orderStatus: string;
  flow: FlowStep[];
  isBuyerView: boolean;
  /** OSRM-based road ETA in minutes */
  roadEtaMinutes?: number | null;
  /** DB estimated_delivery_at ISO string */
  estimatedDeliveryAt?: string | null;
  /** Seller/restaurant name */
  sellerName?: string | null;
  /** Route total distance in meters */
  totalRouteDistance?: number | null;
  /** Remaining distance in meters */
  remainingDistance?: number | null;
  /** Whether rider location is available */
  hasRiderLocation?: boolean;
}

// Internal status → phase mapping
const STATUS_PHASE_MAP: Record<string, DisplayStatusResult['phase']> = {
  placed: 'placed',
  payment_pending: 'placed',
  enquired: 'placed',
  quoted: 'placed',
  accepted: 'preparing',
  confirmed: 'preparing',
  preparing: 'preparing',
  processing: 'preparing',
  ready: 'ready',
  ready_for_delivery: 'ready',
  ready_for_pickup: 'ready',
  picked_up: 'transit',
  on_the_way: 'transit',
  in_transit: 'transit',
  at_gate: 'transit',
  en_route: 'transit',
  delivered: 'delivered',
  completed: 'delivered',
  cancelled: 'cancelled',
  rejected: 'cancelled',
  expired: 'cancelled',
};

function getPhase(status: string, flow: FlowStep[]): DisplayStatusResult['phase'] {
  const step = flow.find(s => s.status_key === status);
  if (step?.is_terminal && step?.is_success) return 'delivered';
  if (step?.is_terminal && !step?.is_success) return 'cancelled';
  if (step?.is_transit) return 'transit';

  // Prefer flow position over hardcoded names when we have steps
  if (flow.length > 0 && step) {
    const active = flow.filter(s => !s.is_terminal).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = active.findIndex(s => s.status_key === status);
    if (idx === 0) return 'placed';
    if (idx === active.length - 1 && idx > 0) return 'ready';
    if (idx > 0) return 'preparing';
  }

  return STATUS_PHASE_MAP[status] || 'preparing';
}

function computeProgressPercent(
  phase: DisplayStatusResult['phase'],
  orderStatus: string,
  flow: FlowStep[],
  totalRouteDistance?: number | null,
  remainingDistance?: number | null,
): number {
  switch (phase) {
    case 'placed': return 5;
    case 'preparing': return 20;
    case 'ready': return 35;
    case 'transit': {
      // Route-based progress if available
      if (totalRouteDistance && remainingDistance != null && totalRouteDistance > 0) {
        const routeProgress = ((totalRouteDistance - remainingDistance) / totalRouteDistance) * 100;
        // Map route progress (0-100) to the transit portion (40-95)
        return Math.max(40, Math.min(95, 40 + routeProgress * 0.55));
      }
      // Fallback: position within transit steps
      const transitSteps = flow.filter(s => s.is_transit);
      const currentIdx = transitSteps.findIndex(s => s.status_key === orderStatus);
      if (transitSteps.length > 0 && currentIdx >= 0) {
        return 40 + ((currentIdx + 1) / transitSteps.length) * 55;
      }
      return 60;
    }
    case 'delivered': return 100;
    case 'cancelled': return 0;
    default: return 10;
  }
}

function computeEtaFlag(
  roadEtaMinutes: number | null | undefined,
  estimatedDeliveryAt: string | null | undefined,
): DisplayStatusResult['etaFlag'] {
  if (!roadEtaMinutes || !estimatedDeliveryAt) return null;
  
  const estimatedTime = new Date(estimatedDeliveryAt).getTime();
  const actualArrivalTime = Date.now() + roadEtaMinutes * 60000;
  const diffMinutes = (actualArrivalTime - estimatedTime) / 60000;
  
  if (diffMinutes <= 3) return 'on_time';
  if (diffMinutes <= 5) return 'slight_delay';
  return 'delayed';
}

const ETA_FLAG_LABELS: Record<string, string> = {
  on_time: 'On time',
  slight_delay: 'Slight delay',
  delayed: 'Delayed',
};

export function deriveDisplayStatus(options: DeriveOptions): DisplayStatusResult {
  const {
    orderStatus,
    flow,
    isBuyerView,
    roadEtaMinutes,
    estimatedDeliveryAt,
    sellerName,
    totalRouteDistance,
    remainingDistance,
    hasRiderLocation,
  } = options;

  const phase = getPhase(orderStatus, flow);
  const progressPercent = computeProgressPercent(phase, orderStatus, flow, totalRouteDistance, remainingDistance);
  const etaFlag = phase === 'transit' ? computeEtaFlag(roadEtaMinutes, estimatedDeliveryAt) : null;

  // Build ETA text
  let etaText: string | null = null;
  if (phase === 'transit' && roadEtaMinutes) {
    const flagLabel = etaFlag ? ` · ${ETA_FLAG_LABELS[etaFlag]}` : '';
    etaText = roadEtaMinutes > 3
      ? `${roadEtaMinutes - 1}–${roadEtaMinutes + 1} min${flagLabel}`
      : `${roadEtaMinutes} min${flagLabel}`;
  }

  // Build display text
  const name = sellerName || 'Seller';
  let text: string;
  let emoji: string;

  // Phase → icon mapping
  const PHASE_ICONS: Record<string, { icon: string; iconColor: string }> = {
    placed: { icon: 'ClipboardList', iconColor: 'text-blue-500 bg-blue-500/15' },
    preparing: { icon: 'ChefHat', iconColor: 'text-amber-500 bg-amber-500/15' },
    ready: { icon: 'PackageCheck', iconColor: 'text-emerald-500 bg-emerald-500/15' },
    transit: { icon: 'Bike', iconColor: 'text-violet-500 bg-violet-500/15' },
    delivered: { icon: 'CircleCheckBig', iconColor: 'text-emerald-500 bg-emerald-500/15' },
    cancelled: { icon: 'XCircle', iconColor: 'text-red-500 bg-red-500/15' },
  };

  const phaseIcon = PHASE_ICONS[phase] || { icon: 'Package', iconColor: 'text-muted-foreground bg-muted' };

  switch (phase) {
    case 'placed':
      text = isBuyerView ? 'Order placed' : 'New order received';
      break;
    case 'preparing':
      text = isBuyerView
        ? `${name} is preparing your order`
        : 'Preparing order';
      break;
    case 'ready':
      text = isBuyerView
        ? 'Your order is ready'
        : 'Ready for pickup';
      break;
    case 'transit':
      if (roadEtaMinutes && hasRiderLocation) {
        text = isBuyerView
          ? `Arriving in ${roadEtaMinutes > 3 ? `${roadEtaMinutes - 1}–${roadEtaMinutes + 1}` : roadEtaMinutes} min`
          : 'Out for delivery';
      } else {
        text = isBuyerView ? 'Picked up · On the way' : 'Out for delivery';
      }
      break;
    case 'delivered':
      text = isBuyerView ? 'Delivered' : 'Order completed';
      break;
    case 'cancelled':
      text = 'Cancelled';
      break;
    default:
      text = orderStatus.replace(/_/g, ' ');
  }

  return {
    text,
    etaText,
    etaFlag,
    progressPercent,
    phase,
    icon: phaseIcon.icon,
    iconColor: phaseIcon.iconColor,
    emoji: '', // deprecated
  };
}
