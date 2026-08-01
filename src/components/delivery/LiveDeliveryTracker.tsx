// @ts-nocheck
import { useDeliveryTracking, type DeliveryTrackingState } from '@/hooks/useDeliveryTracking';
import { Phone, Truck, Navigation, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSystemSettingsRaw } from '@/hooks/useSystemSettingsRaw';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';

interface StatusHint {
  buyer_hint?: string | null;
  seller_hint?: string | null;
  display_label?: string | null;
}

interface LiveDeliveryTrackerProps {
  assignmentId: string;
  isBuyerView: boolean;
  trackingState?: DeliveryTrackingState;
  roadEtaMinutes?: number | null;
  statusHints?: Record<string, StatusHint>;
  /** Workflow-derived transit flag — overrides system_settings when provided */
  isInTransit?: boolean;
  /** Derived display status text — shown instead of raw workflow status */
  displayStatusText?: string | null;
}

interface ProximityThreshold {
  max_meters?: number;
  buyer_message?: string;
  seller_message?: string;
  buyer_prefix?: string;
  seller_prefix?: string;
  suffix?: string;
}

interface ProximityConfig {
  at_doorstep: ProximityThreshold;
  arriving: ProximityThreshold;
  nearby: ProximityThreshold;
  eta_2min: ProximityThreshold;
  eta_5min: ProximityThreshold;
  default: ProximityThreshold;
}

const DEFAULT_PROXIMITY: ProximityConfig = {
  at_doorstep: { max_meters: 50, buyer_message: '🏠 At your doorstep!', seller_message: '🏠 You are at the doorstep.' },
  arriving: { max_meters: 200, buyer_message: '🏃 Almost there!', seller_message: '🏃 You are almost there.' },
  nearby: { max_meters: 500, buyer_message: '📍 Arriving soon!', seller_message: '📍 Buyer is nearby on your route.' },
  eta_2min: { buyer_message: '⏱️ Arriving in about 2 minutes', seller_message: '⏱️ Around 2 minutes away' },
  eta_5min: { buyer_prefix: '⏱️ Arriving in about', seller_prefix: '⏱️ Around', suffix: 'minutes' },
  default: { buyer_message: '🛵 On the way to you', seller_message: '🛵 Delivery in progress' },
};

function formatDistance(meters: number | null): string {
  if (!meters) return '';
  if (meters < 1000) return `${meters}m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

function computeDistanceEta(distanceMeters: number): number {
  return Math.max(1, Math.ceil(distanceMeters / 1000 * 4));
}

function getSmartEta(distance: number | null, dbEta: number | null, roadEta?: number | null, isLocationStale?: boolean): number | null {
  // If location data is stale, don't trust any ETA
  if (isLocationStale) return null;
  if (roadEta != null && roadEta > 0) return roadEta;
  if (distance !== null && distance < 500) {
    return computeDistanceEta(distance);
  }
  if (distance !== null && dbEta !== null && dbEta > computeDistanceEta(distance)) {
    return computeDistanceEta(distance);
  }
  return dbEta;
}

function getProximityMessage(
  distance: number | null,
  eta: number | null,
  proximityStatus: string | null,
  isBuyerView: boolean,
  config: ProximityConfig,
): string {
  const msg = (key: keyof ProximityConfig) =>
    isBuyerView ? config[key].buyer_message : config[key].seller_message;

  if (proximityStatus === 'at_doorstep') return msg('at_doorstep');
  if (proximityStatus === 'arriving') return msg('arriving');
  if (proximityStatus === 'nearby') return msg('nearby');

  const smartEta = getSmartEta(distance, eta, null, false);

  if (distance !== null && distance < (config.at_doorstep.max_meters ?? 50)) return msg('at_doorstep');
  if (distance !== null && distance < (config.arriving.max_meters ?? 200)) return msg('arriving');
  if (distance !== null && distance < (config.nearby.max_meters ?? 500)) return msg('nearby');

  if (smartEta !== null && smartEta <= 2) return msg('eta_2min');
  if (smartEta !== null && smartEta <= 5) {
    const c = config.eta_5min;
    const prefix = isBuyerView ? (c.buyer_prefix || '⏱️ Arriving in about') : (c.seller_prefix || '⏱️ Around');
    return `${prefix} ${smartEta} ${c.suffix || 'minutes'}`;
  }
  if (smartEta !== null) return `🕐 ETA: ${smartEta} minutes`;
  if (distance !== null) return `📏 ${formatDistance(distance)}`;
  return msg('default');
}

function getLastSeenText(lastLocationAt: string | null): string | null {
  if (!lastLocationAt) return null;
  const diffMs = Date.now() - new Date(lastLocationAt).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return null;
  if (diffMin > 3) return `Last seen ${diffMin} min ago`;
  return null;
}

export function LiveDeliveryTracker({ assignmentId, isBuyerView, trackingState, roadEtaMinutes, statusHints, isInTransit: isInTransitProp, displayStatusText }: LiveDeliveryTrackerProps) {
  const ownTracking = useDeliveryTracking(trackingState ? null : assignmentId);
  const tracking = trackingState || ownTracking;
  const trackingConfig = useTrackingConfig();

  // Load proximity config from DB
  const { getSetting } = useSystemSettingsRaw(['proximity_thresholds', 'ui_live_tracking_title', 'ui_delivery_partner_label', 'ui_location_stale_warning']);
  const rawProximity = getSetting('proximity_thresholds');
  let proximityConfig = DEFAULT_PROXIMITY;
  try {
    if (rawProximity) proximityConfig = { ...DEFAULT_PROXIMITY, ...JSON.parse(rawProximity) };
  } catch { /* use defaults */ }

  const liveTrackingTitle = getSetting('ui_live_tracking_title') || 'Live Tracking';
  const deliveryPartnerLabel = getSetting('ui_delivery_partner_label') || 'Delivery Partner';
  const staleWarning = getSetting('ui_location_stale_warning') || 'Location may be outdated — GPS is not updating';

  if (tracking.isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  if (!tracking.status) return null;

  // Use workflow-derived isInTransit prop when available, fallback to system_settings
  const transitSet = new Set(trackingConfig.transit_statuses);
  const isInTransit = isInTransitProp ?? (tracking.status ? transitSet.has(tracking.status) : false);
  const lastSeen = getLastSeenText(tracking.lastLocationAt);

  return (
    <div className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Navigation size={16} className="text-primary" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{liveTrackingTitle}</p>
        </div>
      {(() => {
          const isStale = tracking.isLocationStale || !tracking.lastLocationAt;
          const smartEta = getSmartEta(tracking.distance, tracking.eta, roadEtaMinutes, isStale);
          return smartEta && isInTransit ? (
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Clock size={10} className="mr-1" />
              {smartEta > 3 ? `${smartEta - 1}–${smartEta + 1} min` : `${smartEta} min`}
            </Badge>
          ) : null;
        })()}
      </div>

      {isInTransit && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
          <p className="text-sm font-semibold text-primary">
            {getProximityMessage(tracking.distance, tracking.eta, tracking.proximityStatus, isBuyerView, proximityConfig)}
          </p>
          {tracking.distance !== null && tracking.distance > 500 && (
            <p className="text-xs text-muted-foreground mt-1">{formatDistance(tracking.distance)}</p>
          )}
          {tracking.isLocationStale && (
            <p className="text-[10px] text-destructive mt-1">⚠️ {staleWarning}</p>
          )}
          {!tracking.isLocationStale && lastSeen && (
            <p className="text-[10px] text-muted-foreground mt-1">⚠️ {lastSeen}</p>
          )}
        </div>
      )}

      {tracking.riderName && (
        <div className="flex items-center justify-between bg-muted/30 backdrop-blur-sm rounded-lg p-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
              {tracking.riderPhotoUrl ? (
                <img src={tracking.riderPhotoUrl} alt={deliveryPartnerLabel} className="w-full h-full object-cover" />
              ) : (
                <Truck size={16} className="text-primary" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{tracking.riderName}</p>
              <p className="text-[11px] text-muted-foreground">{deliveryPartnerLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tracking.riderPhone && (
              <a href={`tel:${tracking.riderPhone}`} className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                <Phone size={14} className="text-accent" />
              </a>
            )}
          </div>
        </div>
      )}

      {(() => {
        // Use derived display status text when available (Zomato-style single sentence)
        if (displayStatusText) {
          return <p className="text-xs text-muted-foreground font-medium tracking-status-fade">{displayStatusText}</p>;
        }
        if (!tracking.status) return null;
        const hint = statusHints?.[tracking.status];
        const message = isBuyerView
          ? (hint?.buyer_hint || hint?.display_label || tracking.status)
          : ((hint as any)?.seller_hint || hint?.display_label || tracking.status);
        return message ? (
          <p className="text-xs text-muted-foreground">{message}</p>
        ) : null;
      })()}
    </div>
  );
}
