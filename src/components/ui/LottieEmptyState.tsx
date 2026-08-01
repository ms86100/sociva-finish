// @ts-nocheck
import { motion } from 'framer-motion';
import { emptyState } from '@/lib/motion-variants';

interface LottieEmptyStateProps {
  emoji: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Animated empty state with bouncy entrance.
 * Uses emoji + framer-motion for lightweight delight without network-dependent Lottie JSONs.
 */
export function LottieEmptyState({ emoji, title, description, children, className }: LottieEmptyStateProps) {
  return (
    <motion.div
      variants={emptyState}
      initial="hidden"
      animate="show"
      className={`flex flex-col items-center text-center ${className || ''}`}
    >
      {/* Animated emoji with pulse ring */}
      <div className="relative mb-4">
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full bg-primary/15"
        />
        <motion.div
          initial={{ scale: 0.5, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.15 }}
          className="relative w-20 h-20 rounded-full bg-muted flex items-center justify-center"
        >
          <span className="text-4xl">{emoji}</span>
        </motion.div>
      </div>

      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="text-lg font-bold text-foreground mb-1"
      >
        {title}
      </motion.h2>

      {description && (
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          className="text-sm text-muted-foreground max-w-xs mb-4"
        >
          {description}
        </motion.p>
      )}

      {children && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.3 }}
        >
          {children}
        </motion.div>
      )}
    </motion.div>
  );
}
