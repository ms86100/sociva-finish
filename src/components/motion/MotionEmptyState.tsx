// @ts-nocheck
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { emptyState } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

type MotionEmptyStateProps = {
  title: string;
  description?: string;
  /** Visual mark - emoji string or React node (icon). Never fake product data. */
  mark?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * Empty-result presentation. Distinct from loading skeletons and LoadFailureState.
 */
export function MotionEmptyState({
  title,
  description,
  mark,
  children,
  className,
}: MotionEmptyStateProps) {
  return (
    <motion.div
      variants={emptyState}
      initial="hidden"
      animate="show"
      role="status"
      data-testid="motion-empty-state"
      className={cn('flex flex-col items-center text-center px-4 py-8', className)}
    >
      {mark != null && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted border border-border/40 text-3xl">
          {mark}
        </div>
      )}
      <h2 className="text-lg font-bold tracking-tight text-foreground mb-1.5">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground max-w-xs mb-4">{description}</p>
      )}
      {children}
    </motion.div>
  );
}
