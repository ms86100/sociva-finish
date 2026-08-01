// @ts-nocheck
import { motion } from 'framer-motion';
import { Truck, Receipt, Sparkles } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { useCountUp } from '@/hooks/useCountUp';
import { cardEntrance } from '@/lib/motion-variants';

interface OrderTotalsCardProps {
  subtotal: number;
  total: number;
  discount?: number;
  deliveryFee?: number;
  isDeliveryOrder: boolean;
  savings?: number;
  itemCount: number;
}

export function OrderTotalsCard({
  subtotal,
  total,
  discount = 0,
  deliveryFee = 0,
  isDeliveryOrder,
  savings = 0,
  itemCount,
}: OrderTotalsCardProps) {
  const { formatPrice, currencySymbol } = useCurrency();
  const animatedTotal = useCountUp(Math.round(total), 700);

  return (
    <motion.div
      variants={cardEntrance}
      className="relative overflow-hidden bg-card/80 backdrop-blur-lg border border-border/50 rounded-2xl shadow-[0_2px_12px_-6px_hsl(var(--foreground)/0.08)]"
    >
      {/* Soft accent strip */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-primary via-primary/60 to-transparent" />

      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Receipt size={14} className="text-primary" />
          </div>
          <p className="text-xs font-semibold text-foreground tracking-wide">Bill Details</p>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {itemCount} item{itemCount !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatPrice(subtotal)}</span>
          </div>

          {discount > 0 && (
            <div className="flex justify-between text-primary">
              <span className="flex items-center gap-1.5">
                <Sparkles size={12} /> Discount
              </span>
              <span className="tabular-nums font-medium">-{formatPrice(discount)}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Truck size={12} /> Delivery
            </span>
            {isDeliveryOrder ? (
              <span className={`tabular-nums font-medium ${deliveryFee > 0 ? '' : 'text-primary'}`}>
                {deliveryFee > 0 ? formatPrice(deliveryFee) : 'FREE'}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">Self pickup</span>
            )}
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-dashed border-border/70 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-foreground">Total</span>
          <motion.span
            key={total}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xl font-bold text-primary tabular-nums"
          >
            {currencySymbol}{animatedTotal.toLocaleString()}
          </motion.span>
        </div>

        {savings > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-2.5 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <span className="text-xs">🎉</span>
            <span className="text-xs font-semibold">You saved {formatPrice(savings)} on this order!</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
