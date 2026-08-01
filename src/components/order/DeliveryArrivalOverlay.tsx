// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Phone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProximityMessages {
  at_doorstep_title?: string;
  arriving_title?: string;
  subtitle?: string;
}

interface DeliveryArrivalOverlayProps {
  distance: number | null;
  eta: number | null;
  riderName: string | null;
  riderPhone: string | null;
  status: string | null;
  onDismiss: () => void;
  deliveryCode?: string | null;
  proximityMessages?: ProximityMessages;
  /** DB-backed transit statuses for determining visibility */
  transitStatuses?: string[];
  /** DB-backed distance threshold for overlay visibility */
  overlayDistanceMeters?: number;
  /** DB-backed doorstep distance threshold */
  doorstepDistanceMeters?: number;
}

export function DeliveryArrivalOverlay({
  distance,
  eta,
  riderName,
  riderPhone,
  status,
  onDismiss,
  deliveryCode,
  proximityMessages,
  transitStatuses,
  overlayDistanceMeters = 200,
  doorstepDistanceMeters = 50,
}: DeliveryArrivalOverlayProps) {
  const [dismissed, setDismissed] = useState(false);
  // Session-persistent dismiss: once dismissed, stays dismissed until assignmentId/status fundamentally changes
  const dismissedForStatus = useRef<string | null>(null);

  const transitSet = new Set(transitStatuses ?? ['picked_up', 'on_the_way', 'at_gate']);

  // Show only when distance < threshold and in transit
  const isImminent = distance !== null && distance < overlayDistanceMeters &&
    transitSet.has(status || '');

  // If dismissed for this status, stay dismissed
  const visible = isImminent && !dismissed && dismissedForStatus.current !== status;

  // Only reset dismiss when status changes to a NEW transit status (not on every tick)
  const prevStatus = useRef(status);
  useEffect(() => {
    if (status !== prevStatus.current) {
      prevStatus.current = status;
      // Only reset if moving to a different transit status
      if (status && transitSet.has(status) && dismissedForStatus.current !== status) {
        setDismissed(false);
      }
    }
  }, [status]);

  const handleDismiss = () => {
    setDismissed(true);
    dismissedForStatus.current = status;
    onDismiss();
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed inset-0 z-[60] flex items-center justify-center px-4 pointer-events-none"
          onClick={handleDismiss}
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            className="w-full max-w-sm bg-card border-2 border-primary/30 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Pulsing header */}
            <div className="bg-primary/10 p-3 text-center relative">
              <button
                onClick={handleDismiss}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-muted flex items-center justify-center"
              >
                <X size={14} className="text-muted-foreground" />
              </button>
              <motion.div
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-2"
              >
                <MapPin size={20} className="text-primary" />
              </motion.div>
              <h2 className="text-base font-bold text-foreground">
                {distance !== null && distance < doorstepDistanceMeters
                  ? (proximityMessages?.at_doorstep_title || '🏠 At your doorstep!')
                  : (proximityMessages?.arriving_title || '🏃 Driver arriving now!')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {proximityMessages?.subtitle || 'Please get ready to receive your order'}
              </p>
            </div>

            {/* Info */}
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Distance</span>
                <span className="font-semibold text-foreground">
                  {distance !== null ? (distance < 100 ? `${distance}m` : `${(distance / 1000).toFixed(1)} km`) : '—'}
                </span>
              </div>
              {eta != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">ETA</span>
                  <span className="font-semibold text-primary">{eta} min</span>
                </div>
              )}
              {riderName && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Delivery Partner</span>
                  <span className="font-semibold text-foreground">{riderName}</span>
                </div>
              )}

              {riderPhone && (
                <a href={`tel:${riderPhone}`} className="block">
                  <Button variant="outline" size="sm" className="w-full gap-2">
                    <Phone size={14} />
                    Call Delivery Partner
                  </Button>
                </a>
              )}

              {deliveryCode && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Your Delivery OTP</p>
                  <p className="text-xl font-bold tracking-[0.3em] text-primary">{deliveryCode}</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
