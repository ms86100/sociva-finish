// @ts-nocheck
import { motion, type HTMLMotionProps } from 'framer-motion';
import {
  getStaggerGrid,
  listItem,
  staggerContainer,
} from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

type MotionListProps = HTMLMotionProps<'div'> & {
  /** Use grid stagger timing */
  variant?: 'list' | 'grid';
};

/**
 * Stagger container. Children that accept Framer `variants` (e.g. MotionCard)
 * should use the list/card entrance variants as stagger children.
 */
export function MotionList({
  className,
  variant = 'list',
  children,
  ...props
}: MotionListProps) {
  const container = variant === 'grid' ? getStaggerGrid() : staggerContainer;

  return (
    <motion.div
      className={cn(className)}
      variants={container}
      initial="hidden"
      animate="show"
      {...props}
    >
      {children}
    </motion.div>
  );
}

type MotionListItemProps = HTMLMotionProps<'div'>;

export function MotionListItem({ className, children, ...props }: MotionListItemProps) {
  return (
    <motion.div className={cn(className)} variants={listItem} {...props}>
      {children}
    </motion.div>
  );
}
