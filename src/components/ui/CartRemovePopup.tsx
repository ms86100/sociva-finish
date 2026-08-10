// @ts-nocheck
import { motion } from 'framer-motion';
import { X, RotateCcw, Search, Grid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { easings, durations } from '@/lib/motion-variants';

interface CartRemovePopupProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  onContinueShopping?: () => void;
}

export function CartRemovePopup({
  isOpen,
  onClose,
  productName,
  onContinueShopping,
}: CartRemovePopupProps) {
  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.fast }}
      className="fixed inset-0 z-[100] pointer-events-none"
      aria-hidden={!isOpen}
    >
      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: durations.normal }}
        className="fixed inset-0 bg-foreground/20 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
      />

      {/* Popup */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -20 }}
        transition={{
          type: 'spring',
          stiffness: 350,
          damping: 22,
        }}
        className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-auto"
      >
        <div className={cn(
          "relative rounded-3xl bg-background border border-border shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] overflow-hidden",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-300"
        )}>
          {/* Header with gentle animation */}
          <div className="relative px-6 pt-6 pb-4">
            <div className="absolute inset-0 overflow-hidden rounded-t-3xl">
              {/* Gentle floating particles */}
              {[...Array(6)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: [0, 0.4, 0], scale: [0, 1, 0] }}
                  transition={{
                    duration: 2,
                    delay: i * 0.2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="absolute w-3 h-3 bg-primary/30 rounded-full"
                  style={{
                    left: `${20 + Math.random() * 60}%`,
                    top: `${30 + Math.random() * 50}%`,
                  }}
                />
              ))}
              {/* Central icon */}
              <motion.div
                initial={{ scale: 0, opacity: 0, rotate: -180 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.15 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-muted/60 to-muted/30 flex items-center justify-center border border-border/50">
                  <motion.div
                    animate={{ rotate: [0, -15, 15, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <RotateCcw className="w-8 h-8 text-muted-foreground/60" />
                  </motion.div>
                </div>
              </motion.div>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute right-4 top-4 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm border border-border flex items-center justify-center text-muted-foreground hover:bg-white hover:text-foreground hover:border-primary/30 transition-all"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 pb-6 text-center">
            {/* Title */}
            <motion.h3
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: durations.normal, ease: easings.easeOut }}
              className="text-xl font-bold text-foreground mb-2"
            >
              Item Removed
            </motion.h3>

            {/* Product name */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: durations.normal, ease: easings.easeOut }}
              className="text-base text-muted-foreground mb-4"
            >
              <span className="font-medium text-foreground">"{productName}"</span> has been removed from your cart.
            </motion.p>

            {/* Friendly suggestion */}
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.4, type: 'spring', stiffness: 300, damping: 22 }}
              className="p-4 rounded-2xl bg-gradient-to-br from-muted/40 to-muted/20 border border-border/50 mb-6"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                  <Search className="w-4 h-4 text-primary" />
                </div>
                <div className="text-left text-sm">
                  <p className="font-medium text-foreground mb-1">Changed your mind? No worries!</p>
                  <p className="text-muted-foreground">
                    Explore something else or try another category.
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: durations.normal, ease: easings.easeOut }}
              className="flex gap-3"
            >
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 rounded-xl bg-muted text-foreground font-medium transition-colors hover:bg-muted/80 active:scale-[0.98]"
              >
                OK
              </button>
              <button
                onClick={() => { onClose(); onContinueShopping?.(); }}
                className="flex-1 px-4 py-3 rounded-xl border border-border text-foreground font-medium transition-all hover:bg-muted hover:border-primary/30 active:scale-[0.98]"
              >
                <Grid className="w-4 h-4 mr-2 inline-block" />
                Browse Categories
              </button>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}