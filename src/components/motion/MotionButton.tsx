// @ts-nocheck
import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { buttonPress, scalePress } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

type MotionButtonProps = HTMLMotionProps<'button'> & {
  /** Stronger hover/tap scale */
  emphasized?: boolean;
};

export const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(
  function MotionButton({ className, emphasized = false, children, ...props }, ref) {
    const press = emphasized ? buttonPress : scalePress;
    return (
      <motion.button
        ref={ref}
        type="button"
        className={cn(className)}
        {...press}
        {...props}
      >
        {children}
      </motion.button>
    );
  },
);
