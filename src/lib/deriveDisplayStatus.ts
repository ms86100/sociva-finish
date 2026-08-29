// @ts-nocheck
/**
 * Derives a single human-readable display status from internal workflow state.
 * This is the presentation layer — no DB changes, purely computed.
 * Progress phases align with the shared 4-stage rail in orderProgressStages.
 */

import {
  progressStageToPhase,
  resolveOrderProgress,
} from '@/lib/orderProgressStages';

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
  orderType?: string | null;
  isEnquiryOrder?: boolean;
  /** Order fulfillment_type — drives delivery vs pickup stage mapping */
  fulfillmentType?: string | null;
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

function getPhase(
  status: string,
  flow: FlowStep[],
  fulfillmentType?: string | null,
): DisplayStatusResult['phase'] {
  const step = flow.find(s => s.status_key === status);
  if (step?.is_terminal && step?.is_success) return 'delivered';
  if (step?.is_terminal && !step?.is_success) return 'cancelled';

  // Shared 4-stage presentation (buyer + seller identical)
  const progress = resolveOrderProgress({
    status,
    fulfillmentType,
    flowIsTransit: step?.is_transit === true,
  });
  if (progress.kind === 'end_state') return 'cancelled';
  return progressStageToPhase(progress);
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
    orderType,
    isEnquiryOrder,
    fulfillmentType,
    roadEtaMinutes,
    estimatedDeliveryAt,
    sellerName,
    totalRouteDistance,
    remainingDistance,
    hasRiderLocation,
  } = options;

  // Honest labels for payment holds (before phase copy)
  if (orderStatus === 'payment_pending') {
    return {
      text: isBuyerView ? 'Complete your payment' : 'Awaiting buyer payment',
      etaText: null,
      etaFlag: null,
      progressPercent: 5,
      phase: 'placed',
      icon: 'CreditCard',
      iconColor: 'text-amber-500 bg-amber-500/15',
      emoji: '',
    };
  }
  if (orderStatus === 'awaiting_cod_confirmation') {
    return {
      text: isBuyerView ? 'Waiting for cash confirmation' : 'Confirm cash received',
      etaText: null,
      etaFlag: null,
      progressPercent: 90,
      phase: 'delivered',
      icon: 'Banknote',
      iconColor: 'text-amber-500 bg-amber-500/15',
      emoji: '',
    };
  }

  const phase = getPhase(orderStatus, flow, fulfillmentType);
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

  let phaseIcon = PHASE_ICONS[phase] || { icon: 'Package', iconColor: 'text-muted-foreground bg-muted' };

  const isEnquiry = isEnquiryOrder || orderType === 'enquiry' || orderStatus === 'enquired' || orderStatus === 'quoted';

  if (orderStatus === 'quoted') {
    phaseIcon = { icon: 'Receipt', iconColor: 'text-amber-500 bg-amber-500/15' };
  } else if (orderStatus === 'enquired' || (phase === 'placed' && isEnquiry)) {
    phaseIcon = { icon: 'MessageCircle', iconColor: 'text-blue-500 bg-blue-500/15' };
  }

  switch (phase) {
    case 'placed':
      if (orderStatus === 'quoted') {
        text = isBuyerView ? 'Quote received — review and accept' : 'Quote sent to buyer';
      } else if (orderStatus === 'enquired' || isEnquiry) {
        text = isBuyerView ? 'Quote request sent' : 'New quote request received';
      } else {
        text = isBuyerView ? 'Order placed' : 'New order received';
      }
      break;
    case 'preparing':
      text = isBuyerView
        ? `${name} is preparing your order`
        : 'Preparing order';
      break;
    case 'ready':
      text = isBuyerView
        ? 'Ready for pickup'
        : 'Ready for pickup';
      break;
    case 'transit':
      if (roadEtaMinutes && hasRiderLocation) {
        text = isBuyerView
          ? `Arriving in ${roadEtaMinutes > 3 ? `${roadEtaMinutes - 1}–${roadEtaMinutes + 1}` : roadEtaMinutes} min`
          : 'On the way';
      } else {
        text = isBuyerView ? 'On the way' : 'On the way';
      }
      break;
    case 'delivered':
      text = isBuyerView
        ? (fulfillmentType === 'self_pickup' || fulfillmentType === 'pickup' ? 'Picked up' : 'Delivered')
        : 'Order completed';
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
