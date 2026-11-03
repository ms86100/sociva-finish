// @ts-nocheck
import { motion, type HTMLMotionProps } from 'framer-motion';
import { fadeSlideUp } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

type MotionSectionProps = HTMLMotionProps<'section'> & {
  /** When false, render without entrance motion */
  animate?: boolean;
};

export function MotionSection({
  className,
  animate = true,
  children,
  ...props
}: MotionSectionProps) {
  if (!animate) {
    return (
      <section className={className} {...props}>
        {children}
      </section>
    );
  }

  return (
    <motion.section
      className={cn(className)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-40px' }}
      variants={fadeSlideUp}
      {...props}
    >
      {children}
    </motion.section>
  );
}
