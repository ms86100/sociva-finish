// @ts-nocheck
import { motion } from 'framer-motion';
import { X, ShoppingBag, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { easings, durations } from '@/lib/motion-variants';

interface CartAddPopupProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  productImage?: string;
  price?: number;
  onViewCart?: () => void;
}

export function CartAddPopup({
  isOpen,
  onClose,
  productName,
  productImage,
  price,
  onViewCart,
}: CartAddPopupProps) {
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
        className="fixed inset-0 bg-foreground/30 backdrop-blur-sm pointer-events-auto"
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
          "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-300",
          "max-w-md w-full max-h-[90vh] overflow-hidden"
        )}>
          {/* Celebration header with animated sparkles */}
          <div className="relative px-6 pt-6 pb-4">
            <div className="absolute inset-0 overflow-hidden rounded-t-3xl">
              {/* Sparkle particles */}
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0, rotate: -45 }}
                  animate={{ opacity: [0, 1, 0], scale: [0, 1, 0.5], rotate: [-45, 0, 45] }}
                  transition={{
                    duration: 1.5,
                    delay: i * 0.08,
                    ease: 'easeOut',
                  }}
                  className="absolute w-4 h-4 bg-gradient-to-br from-primary/80 to-accent/60 rounded-full"
                  style={{
                    left: `${15 + Math.random() * 70}%`,
                    top: `${20 + Math.random() * 60}%`,
                  }}
                />
              ))}
              {/* Central burst */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className="relative">
                  <motion.div
                    animate={{ scale: [1, 1.4, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute inset-0 rounded-full bg-primary/10"
                  />
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                    className="relative w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 via-transparent to-accent/20 flex items-center justify-center"
                  >
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
                      <ShoppingBag className="w-8 h-8 text-white" />
                    </div>
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
            {/* Success text */}
            <motion.h3
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: durations.normal, ease: easings.easeOut }}
              className="text-xl font-bold text-foreground mb-2"
            >
              Added to Cart! 🎉
            </motion.h3>

            {/* Product details */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: durations.normal, ease: easings.easeOut }}
              className="flex items-center justify-center gap-3 p-4 bg-muted/50 rounded-2xl mb-4"
            >
              {productImage && (
                <motion.img
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 20 }}
                  src={productImage}
                  alt={productName}
                  className="w-14 h-14 rounded-xl object-cover bg-muted"
                />
              )}
              <div className="text-left flex-1">
                <motion.p
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4, duration: durations.normal }}
                  className="font-semibold text-foreground text-sm"
                >
                  {productName}
                </motion.p>
                {price && (
                  <motion.p
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.45, duration: durations.normal }}
                    className="text-primary font-bold text-lg"
                  >
                    ₹{price}
                  </motion.p>
                )}
              </div>
            </motion.div>

            {/* Celebration message */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: durations.normal }}
              className="text-sm text-muted-foreground mb-6"
            >
              Great choice! Your item is waiting in the cart.
            </motion.p>

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: durations.normal, ease: easings.easeOut }}
              className="flex gap-3"
            >
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 rounded-xl bg-muted text-foreground font-medium transition-colors hover:bg-muted/80 active:scale-[0.98]"
              >
                Continue Shopping
              </button>
              <button
                onClick={() => { onClose(); onViewCart?.(); }}
                className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium shadow-lg transition-all hover:shadow-xl active:scale-[0.98]"
              >
                <Sparkles className="w-4 h-4 mr-2 inline-block" />
                View Cart
              </button>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}