// @ts-nocheck
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DisplayStatusResult } from '@/lib/deriveDisplayStatus';
import { StatusPhaseIcon } from '@/components/order/StatusPhaseIcon';
import { cn } from '@/lib/utils';
import { Check, WifiOff } from 'lucide-react';
import { cardEntrance, statusTransition } from '@/lib/motion-variants';

interface FlowStep {
  status_key: string;
  display_label?: string;
  buyer_display_label?: string;
  buyer_hint?: string;
  icon?: string;
  is_terminal?: boolean;
  is_transit?: boolean;
  sort_order?: number;
}

interface LiveActivityCardProps {
  displayStatus: DisplayStatusResult;
  sellerName: string;
  riderName?: string | null;
  riderPhone?: string | null;
  hasGps: boolean;
  isLocationStale?: boolean;
  lastUpdateAt?: string | null;
  distanceMeters?: number | null;
  flow?: FlowStep[];
  currentStatus?: string;
}

export function LiveActivityCard({
  displayStatus,
  sellerName,
  riderName,
  hasGps,
  isLocationStale,
  lastUpdateAt,
  distanceMeters,
  flow = [],
  currentStatus,
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

  const staleMinutes = lastUpdateAt
    ? Math.floor((Date.now() - new Date(lastUpdateAt).getTime()) / 60000)
    : null;
  const showStaleWarning = isLocationStale || (staleMinutes != null && staleMinutes > 3);

  const distanceText = distanceMeters
    ? distanceMeters < 1000
      ? `${distanceMeters}m away`
      : `${(distanceMeters / 1000).toFixed(1)} km away`
    : null;

  // Filter steps: remove post-terminal redundant steps
  const displaySteps = flow.length > 0 ? filterDisplaySteps(flow, currentStatus) : [];
  const currentIdx = displaySteps.findIndex(s => s.status_key === currentStatus);

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

      {/* ═══ Swiggy-style horizontal rail stepper ═══ */}
      {displaySteps.length > 0 && (
        <HorizontalRailStepper steps={displaySteps} currentIdx={currentIdx} currentHint={displaySteps[currentIdx]?.buyer_hint} etaText={displayStatus.etaText} />
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

/** Swiggy Instamart-style horizontal rail */
function HorizontalRailStepper({ steps, currentIdx, currentHint, etaText }: {
  steps: FlowStep[];
  currentIdx: number;
  currentHint?: string | null;
  etaText?: string | null;
}) {
  return (
    <div className="space-y-2">
      {/* Rail */}
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const isComplete = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isLast = i === steps.length - 1;

          return (
            <div key={step.status_key} className="flex items-center" style={{ flex: isLast ? '0 0 auto' : '1 1 0' }}>
              {/* Node */}
              <div className="relative flex flex-col items-center" style={{ zIndex: 2 }}>
                <motion.div
                  className={cn(
                    'rounded-full flex items-center justify-center shrink-0',
                    isComplete ? 'w-5 h-5 bg-primary' :
                    isCurrent ? 'w-6 h-6 bg-primary/20 ring-[2.5px] ring-primary/50' :
                    'w-4 h-4 bg-muted'
                  )}
                  animate={isCurrent ? { boxShadow: ['0 0 0px hsl(var(--primary) / 0.3)', '0 0 10px hsl(var(--primary) / 0.4)', '0 0 0px hsl(var(--primary) / 0.3)'] } : {}}
                  transition={isCurrent ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : {}}
                >
                  {isComplete ? (
                    <Check size={10} className="text-primary-foreground" />
                  ) : isCurrent ? (
                    <motion.div
                      className="w-2.5 h-2.5 rounded-full bg-primary"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                  )}
                </motion.div>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className="flex-1 h-[2px] mx-0.5 relative overflow-hidden rounded-full">
                  <div className="absolute inset-0 bg-muted" />
                  {isComplete && (
                    <motion.div
                      className="absolute inset-0 bg-primary rounded-full"
                      initial={{ scaleX: 0, originX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  )}
                  {isCurrent && (
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-primary/40 rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: '40%' }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Labels row */}
      <div className="flex items-start gap-0">
        {steps.map((step, i) => {
          const isComplete = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isLast = i === steps.length - 1;
          const label = step.buyer_display_label || step.display_label || step.status_key?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          // Shorten label for completed steps
          const shortLabel = label.length > 12 ? label.split(' ').slice(0, 2).join(' ') : label;

          return (
            <div
              key={step.status_key}
              className={cn(
                'flex flex-col items-center text-center',
                isLast ? 'flex-none' : 'flex-1'
              )}
              style={{ minWidth: 0 }}
            >
              <p className={cn(
                'text-[9px] leading-tight mt-1 px-0.5',
                isCurrent ? 'font-bold text-foreground' :
                isComplete ? 'font-medium text-primary' :
                'text-muted-foreground/50'
              )}>
                {isCurrent ? label : shortLabel}
              </p>
            </div>
          );
        })}
      </div>

      {/* Current step hint */}
      {currentHint && currentIdx >= 0 && (
        <motion.p
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[10px] text-muted-foreground text-center"
        >
          {currentHint}
        </motion.p>
      )}
    </div>
  );
}

/** Filter out redundant post-terminal steps */
function filterDisplaySteps(flow: FlowStep[], currentStatus?: string): FlowStep[] {
  if (!currentStatus) return flow;
  const currentStep = flow.find(s => s.status_key === currentStatus);

  if (currentStep?.is_terminal) {
    const currentIdx = flow.findIndex(s => s.status_key === currentStatus);
    return flow.slice(0, currentIdx + 1);
  }

  const firstTerminalIdx = flow.findIndex(s => s.is_terminal);
  if (firstTerminalIdx >= 0) {
    return flow.slice(0, firstTerminalIdx + 1);
  }

  return flow;
}
