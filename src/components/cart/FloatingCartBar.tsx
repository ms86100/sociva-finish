// @ts-nocheck
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ShoppingCart, ChevronRight, ChevronUp, X } from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { useCurrency } from '@/hooks/useCurrency';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { cn } from '@/lib/utils';
import { CART_HIDDEN_ROUTES, isRouteHidden } from '@/lib/visibilityEngine';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useImmediateNavigate } from '@/hooks/useImmediateNavigate';

interface FloatingCartBarProps {
  className?: string;
}

export function FloatingCartBar({ className }: FloatingCartBarProps) {
  const { itemCount, totalAmount, items } = useCart();
  const { formatPrice } = useCurrency();
  const location = useLocation();
  const controls = useAnimation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showAdded, setShowAdded] = useState(false);
  const [showRing, setShowRing] = useState(false);
  const navigateImmediately = useImmediateNavigate('FloatingCartBar');

  useEffect(() => {
    const handler = () => {
      controls.start({
        scale: [1, 1.05, 0.97, 1],
        transition: { duration: 0.3, ease: 'easeOut' },
      });
      setShowAdded(true);
      setShowRing(true);
      const t = setTimeout(() => setShowAdded(false), 1500);
      const t2 = setTimeout(() => setShowRing(false), 600);
      return () => { clearTimeout(t); clearTimeout(t2); };
    };
    window.addEventListener('cart-item-added', handler);
    return () => window.removeEventListener('cart-item-added', handler);
  }, [controls]);

  if (itemCount === 0 || isRouteHidden(location.pathname, CART_HIDDEN_ROUTES)) return null;

  const previewItems = items.slice(0, 3);
  const isMomentum = itemCount >= 3;

  return (
    <AnimatePresence>
      <motion.div
        key="floating-cart"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 350, damping: 28 }}
        className={cn(
          'fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 px-4 pb-2',
          className
        )}
      >
        <motion.div
          animate={controls}
          className="rounded-2xl bg-primary shadow-[0_8px_24px_hsl(var(--primary)/0.35)] overflow-hidden ring-1 ring-primary/20"
        >
          <motion.button
            type="button"
            onClick={() => navigateImmediately('/cart')}
            className="w-full px-5 py-3.5 flex items-center justify-between"
            whileTap={{ scale: 0.98 }}
          >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-foreground/20 flex items-center justify-center relative">
                  <ShoppingCart size={17} className="text-primary-foreground" strokeWidth={2.5} />
                  <AnimatePresence>
                    {showRing && (
                      <motion.div
                        className="absolute inset-0 rounded-xl border-2 border-primary-foreground/60"
                        initial={{ scale: 1, opacity: 1 }}
                        animate={{ scale: 1.5, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex flex-col items-start">
                  <AnimatePresence mode="wait">
                    {showAdded ? (
                      <motion.span
                        key="added"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="text-primary-foreground text-sm font-extrabold leading-tight"
                      >
                        Added ✓
                      </motion.span>
                    ) : (
                      <motion.span
                        key="count"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="text-primary-foreground text-sm font-extrabold leading-tight"
                      >
                        {itemCount} item{itemCount !== 1 ? 's' : ''} · {formatPrice(totalAmount)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  <span className="text-[10px] text-primary-foreground/80 font-medium">Tap to checkout</span>
                </div>
              </div>

              <div className="flex items-center gap-1 bg-primary-foreground/15 rounded-xl px-3 py-1.5 text-primary-foreground font-extrabold text-sm">
                {isMomentum ? 'Checkout' : 'View Cart'}
                <ChevronRight size={18} strokeWidth={2.5} />
              </div>
          </motion.button>
        </motion.div>
      </motion.div>

      {/* Mini Cart Preview Drawer */}
      <Drawer open={previewOpen} onOpenChange={setPreviewOpen}>
        <DrawerContent>
          <DrawerHeader className="pb-3">
            <DrawerTitle className="text-sm font-bold">Cart Preview</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-3 px-4">
            {previewItems.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-secondary">
                  {item.product?.image_url ? (
                    <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm">🛍️</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.product?.name || 'Item'}</p>
                  <p className="text-xs text-muted-foreground">×{item.quantity}</p>
                </div>
                <span className="text-sm font-bold tabular-nums">
                  {formatPrice((item.product?.price || 0) * item.quantity)}
                </span>
              </div>
            ))}
            {items.length > 3 && (
              <p className="text-xs text-muted-foreground text-center">+{items.length - 3} more item{items.length - 3 !== 1 ? 's' : ''}</p>
            )}
          </div>
          <Button className="w-full mt-4 rounded-xl px-4" onClick={() => { setPreviewOpen(false); navigateImmediately('/cart'); }}>
            View Full Cart · {formatPrice(totalAmount)}
          </Button>
        </DrawerContent>
      </Drawer>
    </AnimatePresence>
  );
}
