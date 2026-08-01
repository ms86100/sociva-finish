import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { easings } from '@/lib/motion-variants';

interface OrderSuccessOverlayProps {
  show: boolean;
  onDismiss: () => void;
  orderCount?: number;
}

// Lightweight confetti particles using framer-motion
const CONFETTI_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--accent))',
  'hsl(142 76% 56%)',   // green
  'hsl(48 96% 53%)',    // gold
  'hsl(280 67% 60%)',   // purple
  'hsl(200 80% 60%)',   // blue
];

function ConfettiParticle({ index }: { index: number }) {
  const angle = (index / 18) * Math.PI * 2;
  const distance = 80 + Math.random() * 120;
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance - 40;
  const rotation = Math.random() * 720 - 360;
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const size = 4 + Math.random() * 6;
  const isRect = index % 3 !== 0;

  return (
    <motion.div
      className="absolute left-1/2 top-1/2"
      style={{
        width: isRect ? size : size * 0.8,
        height: isRect ? size * 0.5 : size * 0.8,
        borderRadius: isRect ? 1 : '50%',
        backgroundColor: color,
      }}
      initial={{ opacity: 0, x: 0, y: 0, scale: 0, rotate: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        x,
        y: y + 60,
        scale: [0, 1.2, 1, 0.5],
        rotate: rotation,
      }}
      transition={{
        duration: 1.4,
        delay: 0.3 + index * 0.03,
        ease: 'easeOut',
      }}
    />
  );
}

export function OrderSuccessOverlay({ show, onDismiss, orderCount = 1 }: OrderSuccessOverlayProps) {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onDismiss, 400);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [show, onDismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          onClick={() => { setVisible(false); setTimeout(onDismiss, 400); }}
        >
          {/* Green gradient background */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-700"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />

          {/* Confetti */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {Array.from({ length: 18 }).map((_, i) => (
              <ConfettiParticle key={i} index={i} />
            ))}
          </div>

          {/* Checkmark circle */}
          <motion.div
            className="relative z-10 w-24 h-24 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.15, 1] }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <svg viewBox="0 0 64 64" className="w-16 h-16" fill="none">
              <motion.circle
                cx="32" cy="32" r="28"
                stroke="white"
                strokeWidth="3"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, ease: 'easeInOut' }}
              />
              <motion.path
                d="M20 32 L28 40 L44 24"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.35, delay: 0.45, ease: 'easeOut' }}
              />
            </svg>
          </motion.div>

          {/* Text */}
          <motion.h2
            className="relative z-10 text-2xl font-bold text-white mt-6"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, ...easings.spring }}
          >
            Order Placed!
          </motion.h2>

          <motion.p
            className="relative z-10 text-white/80 text-sm mt-2 text-center px-8"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.3 }}
          >
            {orderCount > 1
              ? `${orderCount} orders created successfully`
              : 'Your order is on its way to the seller'}
          </motion.p>

        </motion.div>
      )}
    </AnimatePresence>
  );
}
