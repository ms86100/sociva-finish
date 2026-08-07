// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DisplayStatusResult } from '@/lib/deriveDisplayStatus';
import { StatusPhaseIcon } from '@/components/order/StatusPhaseIcon';
import { OrderProgressRail } from '@/components/order/OrderProgressRail';
import { resolveOrderProgress } from '@/lib/orderProgressStages';
import { WifiOff } from 'lucide-react';
import { cardEntrance, statusTransition } from '@/lib/motion-variants';

interface LiveActivityCardProps {
  displayStatus: DisplayStatusResult;
  sellerName: string;
  riderName?: string | null;
  riderPhone?: string | null;
  hasGps: boolean;
  isLocationStale?: boolean;
  lastUpdateAt?: string | null;
  distanceMeters?: number | null;
  currentStatus?: string;
  fulfillmentType?: string | null;
  flowIsTransit?: boolean;
  /** Optional seller/buyer hint under the rail */
  stageHint?: string | null;
}

export function LiveActivityCard({
  displayStatus,
  sellerName,
  riderName,
  hasGps,
  isLocationStale,
  lastUpdateAt,
  distanceMeters,
  currentStatus,
  fulfillmentType,
  flowIsTransit,
  stageHint,
}: LiveActivityCardProps) {
  const [prevEta, setPrevEta] = useState(displayStatus.etaText);
  const [isEtaAnimating, setIsEtaAnimating] = useState(false);

  useEffect(() => {
    if (displayStatus.etaText !== prevEta) {
      setIsEtaAnimating(true);
      const t = setTimeout(() => {
        setPrevEta(displayStatus.etaText);
        setIsEtaAnimating(false);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [displayStatus.etaText, prevEta]);

  const { phase } = displayStatus;
  const isTransit = phase === 'transit';

  const progress = useMemo(() => {
    if (!currentStatus) return null;
    return resolveOrderProgress({
      status: currentStatus,
      fulfillmentType,
      flowIsTransit,
    });
  }, [currentStatus, fulfillmentType, flowIsTransit]);

  const staleMinutes = lastUpdateAt
    ? Math.floor((Date.now() - new Date(lastUpdateAt).getTime()) / 60000)
    : null;
  const showStaleWarning = isLocationStale || (staleMinutes != null && staleMinutes > 3);

  const distanceText = distanceMeters
    ? distanceMeters < 1000
      ? `${distanceMeters}m away`
      : `${(distanceMeters / 1000).toFixed(1)} km away`
    : null;

  const railHint = stageHint || progress?.subtext || null;

  return (
    <motion.div
      variants={cardEntrance}
      initial="hidden"
      animate="show"
      className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-4 space-y-3 shadow-sm"
    >
      {/* Status header with ETA */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <StatusPhaseIcon icon={displayStatus.icon} iconColor={displayStatus.iconColor} size="md" />
          <div className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.p
                key={displayStatus.text}
                variants={statusTransition}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.25 }}
                className="text-sm font-bold text-foreground truncate"
              >
                {displayStatus.text}
              </motion.p>
            </AnimatePresence>
            {isTransit && distanceText && (
              <p className="text-[11px] text-muted-foreground">{distanceText}</p>
            )}
          </div>
        </div>

        {displayStatus.etaText && (
          <motion.span
            animate={{ opacity: isEtaAnimating ? 0 : 1, y: isEtaAnimating ? 4 : 0 }}
            transition={{ duration: 0.25 }}
            className="text-xs font-bold text-primary whitespace-nowrap"
          >
            {isEtaAnimating ? prevEta : displayStatus.etaText}
          </motion.span>
        )}
      </div>

      {/* Shared 4-stage rail (buyer + seller identical) */}
      {progress?.kind === 'stages' && (
        <OrderProgressRail
          stages={progress.stages}
          currentIndex={progress.stageIndex}
          hint={railHint}
        />
      )}

      {/* Fallback: no GPS during transit */}
      {isTransit && !hasGps && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-center gap-2 text-muted-foreground bg-muted/50 rounded-lg px-3 py-2"
        >
          <WifiOff size={14} />
          <p className="text-[11px]">Tracking temporarily unavailable</p>
        </motion.div>
      )}

      {showStaleWarning && hasGps && (
        <p className="text-[10px] text-warning text-center">
          ⚠️ Last updated {staleMinutes} min ago
        </p>
      )}
    </motion.div>
  );
}
