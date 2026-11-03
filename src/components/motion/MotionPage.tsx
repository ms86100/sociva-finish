import { motion, type HTMLMotionProps } from 'framer-motion';
import { pageTransition } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

type MotionPageProps = HTMLMotionProps<'div'> & {
  /** Skip enter animation (e.g. restoring a tab) */
  instant?: boolean;
};

export function MotionPage({ className, instant, children, ...props }: MotionPageProps) {
  return (
    <motion.div
      className={cn('min-h-0', className)}
      initial={instant ? false : 'initial'}
      animate="animate"
      exit="exit"
      variants={pageTransition}
      {...props}
    >
      {children}
    </motion.div>
  );
}
