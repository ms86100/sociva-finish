import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OrderProgressStageDef } from '@/lib/orderProgressStages';

interface OrderProgressRailProps {
  stages: OrderProgressStageDef[];
  /** 0-based index of the active stage */
  currentIndex: number;
  hint?: string | null;
  title?: string | null;
  className?: string;
}

/**
 * Shared Swiggy-style horizontal progress rail — identical for buyer and seller.
 */
export function OrderProgressRail({
  stages,
  currentIndex,
  hint,
  title,
  className,
}: OrderProgressRailProps) {
  if (stages.length === 0 || currentIndex < 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {title ? (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          {title}
        </p>
      ) : null}

      <div className="flex items-center gap-0">
        {stages.map((stage, i) => {
          const isComplete = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isLast = i === stages.length - 1;

          return (
            <div
              key={stage.key}
              className="flex items-center"
              style={{ flex: isLast ? '0 0 auto' : '1 1 0' }}
            >
              <div className="relative flex flex-col items-center" style={{ zIndex: 2 }}>
                <motion.div
                  className={cn(
                    'rounded-full flex items-center justify-center shrink-0',
                    isComplete
                      ? 'w-5 h-5 bg-primary'
                      : isCurrent
                        ? 'w-6 h-6 bg-primary/20 ring-[2.5px] ring-primary/50'
                        : 'w-4 h-4 bg-muted',
                  )}
                  animate={
                    isCurrent
                      ? {
                          boxShadow: [
                            '0 0 0px hsl(var(--primary) / 0.3)',
                            '0 0 10px hsl(var(--primary) / 0.4)',
                            '0 0 0px hsl(var(--primary) / 0.3)',
                          ],
                        }
                      : {}
                  }
                  transition={
                    isCurrent
                      ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
                      : {}
                  }
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

      <div className="flex items-start gap-0">
        {stages.map((stage, i) => {
          const isComplete = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isLast = i === stages.length - 1;
          const label = isCurrent ? stage.label : stage.shortLabel;

          return (
            <div
              key={stage.key}
              className={cn(
                'flex flex-col items-center text-center',
                isLast ? 'flex-none' : 'flex-1',
              )}
              style={{ minWidth: 0 }}
            >
              <p
                className={cn(
                  'text-[9px] leading-tight mt-1 px-0.5',
                  isCurrent
                    ? 'font-bold text-foreground'
                    : isComplete
                      ? 'font-medium text-primary'
                      : 'text-muted-foreground/50',
                )}
              >
                {label}
              </p>
            </div>
          );
        })}
      </div>

      {hint ? (
        <motion.p
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[10px] text-muted-foreground text-center"
        >
          {hint}
        </motion.p>
      ) : null}
    </div>
  );
}
