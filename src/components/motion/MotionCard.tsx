// @ts-nocheck
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cardEntrance, getCardEntrance, scalePress } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

type MotionCardProps = HTMLMotionProps<'div'> & {
  /** Use native-dampened entrance */
  adaptive?: boolean;
  /** Enable tap scale */
  pressable?: boolean;
  /** Participate as stagger child when parent uses staggerContainer */
  asChildOfStagger?: boolean;
};

export function MotionCard({
  className,
  adaptive = true,
  pressable = false,
  asChildOfStagger = true,
  children,
  ...props
}: MotionCardProps) {
  const variants = adaptive ? getCardEntrance() : cardEntrance;

  return (
    <motion.div
      className={cn(className)}
      variants={asChildOfStagger ? variants : undefined}
      initial={asChildOfStagger ? undefined : 'hidden'}
      animate={asChildOfStagger ? undefined : 'show'}
      {...(pressable ? scalePress : {})}
      {...props}
    >
      {children}
    </motion.div>
  );
}
