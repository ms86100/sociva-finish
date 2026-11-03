// @ts-nocheck
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoadFailureState, type LoadFailureVariant } from '@/components/network/LoadFailureState';
import { MotionEmptyState } from '@/components/motion/MotionEmptyState';
import { contentCrossfade, durations } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

export type ContentPhase =
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'empty'
  | 'error'
  | 'offline'
  | 'image-error';

type ContentLoadStateProps = {
  phase: ContentPhase;
  /** Initial / hard loading UI (skeletons) */
  skeleton: ReactNode;
  /** Real content when phase is ready or refreshing */
  children: ReactNode;
  empty?: {
    title: string;
    description?: string;
    mark?: ReactNode;
    action?: ReactNode;
  };
  failure?: {
    variant?: LoadFailureVariant;
    onRetry?: () => void;
    retrying?: boolean;
    title?: string;
    description?: string;
  };
  className?: string;
};

/**
 * Orchestrates loading / refresh / empty / failure without mixing those states.
 * Refreshing keeps children visible with a light opacity cue.
 */
export function ContentLoadState({
  phase,
  skeleton,
  children,
  empty,
  failure,
  className,
}: ContentLoadStateProps) {
  if (phase === 'loading') {
    return (
      <motion.div
        key="skeleton"
        className={className}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: durations.fast }}
      >
        {skeleton}
      </motion.div>
    );
  }

  if (phase === 'empty') {
    return (
      <MotionEmptyState
        className={className}
        title={empty?.title ?? 'Nothing here yet'}
        description={empty?.description}
        mark={empty?.mark}
      >
        {empty?.action}
      </MotionEmptyState>
    );
  }

  if (phase === 'error' || phase === 'offline' || phase === 'image-error') {
    const variant: LoadFailureVariant =
      phase === 'offline' ? 'offline' : failure?.variant ?? 'error';
    return (
      <LoadFailureState
        className={className}
        variant={variant}
        title={failure?.title}
        description={
          failure?.description ??
          (phase === 'image-error' ? 'Some images could not be loaded.' : undefined)
        }
        onRetry={failure?.onRetry}
        retrying={failure?.retrying}
      />
    );
  }

  // ready | refreshing
  return (
    <div className={cn(className, phase === 'refreshing' && 'opacity-90 transition-opacity duration-300')}>
      <AnimatePresence mode="wait">
        <motion.div
          key="content"
          variants={contentCrossfade}
          initial="initial"
          animate="animate"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Derive ContentPhase from common React Query flags without inventing data. */
export function phaseFromQuery(opts: {
  isLoading: boolean;
  isFetching?: boolean;
  isError?: boolean;
  isEmpty: boolean;
  isOffline?: boolean;
}): ContentPhase {
  if (opts.isOffline) return 'offline';
  if (opts.isLoading) return 'loading';
  if (opts.isError) return 'error';
  if (opts.isEmpty) return 'empty';
  if (opts.isFetching) return 'refreshing';
  return 'ready';
}
