// @ts-nocheck
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { easings } from '@/lib/motion-variants';

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
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center px-6 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Removed from cart"
    >
      <button
        type="button"
        className="absolute inset-0 bg-foreground/40"
        aria-label="Dismiss"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={easings.soft}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'relative z-10 w-[min(20.5rem,calc(100vw-2.5rem))] overflow-hidden rounded-[1.75rem]',
          'pointer-events-auto bg-card text-card-foreground border border-border/80',
          'shadow-[0_24px_60px_-18px_hsl(var(--foreground)/0.28)]',
        )}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-52 w-52 -translate-x-1/2 rounded-full bg-gradient-to-b from-muted to-transparent blur-2xl" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="relative px-6 pb-5 pt-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-success to-primary text-primary-foreground shadow-md">
            <Check className="h-7 w-7" strokeWidth={2.6} />
          </div>

          <h3 className="text-lg font-semibold tracking-tight text-foreground">Removed from cart</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {productName} is no longer in your cart.
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl bg-muted px-3 py-2.5 text-sm font-semibold text-foreground active:scale-[0.98] transition-transform"
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onContinueShopping?.();
              }}
              className="flex-1 rounded-2xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-cta active:scale-[0.98] transition-transform"
            >
              Keep shopping
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
