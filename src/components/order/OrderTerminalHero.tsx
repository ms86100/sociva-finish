// @ts-nocheck
import { motion } from 'framer-motion';
import { XCircle, CircleCheckBig } from 'lucide-react';
import { format } from 'date-fns';
import { ReorderButton } from '@/components/order/ReorderButton';
import { cn } from '@/lib/utils';

interface OrderTerminalHeroProps {
  variant: 'cancelled' | 'delivered';
  reason?: string | null;
  whenISO?: string | null;
  items?: any[];
  sellerId?: string;
  showReorder?: boolean;
}

export function OrderTerminalHero({
  variant,
  reason,
  whenISO,
  items = [],
  sellerId,
  showReorder = true,
}: OrderTerminalHeroProps) {
  const isCancelled = variant === 'cancelled';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className={cn(
        'relative overflow-hidden rounded-2xl p-5 border shadow-[0_4px_20px_-8px_hsl(var(--foreground)/0.12)]',
        isCancelled
          ? 'bg-gradient-to-br from-destructive/10 via-destructive/5 to-transparent border-destructive/20'
          : 'bg-gradient-to-br from-emerald-500/10 via-emerald-400/5 to-transparent border-emerald-500/20',
      )}
    >
      {/* Decorative blob */}
      <div
        className={cn(
          'absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl opacity-40',
          isCancelled ? 'bg-destructive/20' : 'bg-emerald-400/30',
        )}
      />

      <div className="relative flex items-start gap-3">
        <motion.div
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }}
          className={cn(
            'w-12 h-12 rounded-full flex items-center justify-center shrink-0',
            isCancelled ? 'bg-destructive/15' : 'bg-emerald-500/15',
          )}
        >
          {isCancelled ? (
            <XCircle size={26} className="text-destructive" />
          ) : (
            <CircleCheckBig size={26} className="text-emerald-600 dark:text-emerald-400" />
          )}
        </motion.div>

        <div className="flex-1 min-w-0">
          <motion.p
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base font-bold text-foreground"
          >
            {isCancelled ? 'Order Cancelled' : 'Delivered Successfully'}
          </motion.p>
          {reason && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-xs text-muted-foreground mt-1 line-clamp-2"
            >
              {reason}
            </motion.p>
          )}
          {whenISO && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 }}
              className="text-[11px] text-muted-foreground mt-1.5"
            >
              {format(new Date(whenISO), 'MMM d, h:mm a')}
            </motion.p>
          )}
        </div>
      </div>

      {showReorder && items.length > 0 && sellerId && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="relative mt-4 flex justify-end"
        >
          <ReorderButton orderItems={items} sellerId={sellerId} size="sm" />
        </motion.div>
      )}
    </motion.div>
  );
}
