// @ts-nocheck
import { motion } from 'framer-motion';
import { Package } from 'lucide-react';
import { OrderItem, ItemStatus } from '@/types/database';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { useCurrency } from '@/hooks/useCurrency';
import { cn } from '@/lib/utils';

interface OrderItemCardProps {
  item: OrderItem;
  isSellerView: boolean;
  orderStatus: string;
  onStatusUpdate?: (itemId: string, newStatus: ItemStatus) => void;
  index?: number;
}

export function OrderItemCard({ item, index = 0 }: OrderItemCardProps) {
  const { formatPrice } = useCurrency();
  const { getItemStatus } = useStatusLabels();
  const currentStatus = (item.status || 'pending') as ItemStatus;
  const statusInfo = getItemStatus(currentStatus);

  // Image source: prefer joined product.image_url, then product_image (orders list shape)
  const img =
    (item as any).product?.image_url ||
    (item as any).product_image ||
    null;

  // Status dot color (extract first text- token from statusInfo.color → use as bg dot via current color)
  const dotColorClass = (statusInfo.color || '').split(' ').find((c: string) => c.startsWith('text-')) || 'text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      whileTap={{ scale: 0.985 }}
      className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 border-b border-border/40 last:border-b-0"
    >
      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-muted border border-border/50 relative">
        {img ? (
          <img src={img} alt={item.product_name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package size={18} className="text-muted-foreground/60" />
          </div>
        )}
        {/* Strong corner badge — only when qty > 1, with ring for clarity on any thumbnail */}
        {item.quantity > 1 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center shadow-md ring-2 ring-background tabular-nums">
            ×{item.quantity}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground line-clamp-1 flex-1">{item.product_name}</p>
          <p className="text-sm font-semibold tabular-nums shrink-0">
            {formatPrice(item.unit_price * item.quantity)}
          </p>
        </div>
        {/* Inline always-visible Qty pill — clear for both buyer & seller */}
        <div className="mt-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-2 py-0.5 tabular-nums">
            Qty {item.quantity}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn('inline-flex items-center gap-1 text-[10px]', dotColorClass)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', 'bg-current')} />
            {statusInfo.label}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formatPrice(item.unit_price)} each
          </span>
        </div>
      </div>
    </motion.div>
  );
}
