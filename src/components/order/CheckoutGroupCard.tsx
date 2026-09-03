import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Package, Store } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import {
  buyerStoreStatusLabel,
  groupSummaryLabel,
  sumOrderAmounts,
  type CheckoutChildOrder,
} from '@/lib/checkout-groups';
import { humanizeRelativeTime } from '@/lib/relative-time';
import { firstEmbed } from '@/lib/supabase-embed';

function statusTone(label: string): string {
  if (label.includes('Waiting')) return 'text-amber-700';
  if (label.includes('Rejected') || label.includes('Cancelled') || label.includes('failed')) {
    return 'text-destructive';
  }
  if (label.includes('Refund')) return 'text-violet-700';
  if (label.includes('Completed') || label === 'Accepted' || label === 'Preparing') {
    return 'text-emerald-700';
  }
  return 'text-muted-foreground';
}

export function CheckoutGroupCard({
  groupId,
  orders,
}: {
  groupId: string;
  orders: CheckoutChildOrder[];
}) {
  const { formatPrice } = useCurrency();
  const kids = (orders || []).filter((o) => o?.id);
  if (kids.length === 0) return null;
  const total = sumOrderAmounts(kids);
  const summary = groupSummaryLabel(kids);
  const createdAt = kids[0]?.created_at;
  const paymentType = kids[0]?.payment_type;
  const href = groupId.startsWith('soft:')
    ? `/orders/${kids[0].id}`
    : `/checkouts/${groupId}`;

  return (
    <Link to={href} state={groupId.startsWith('soft:') ? { showSiblings: true } : undefined} className="block">
      <motion.div
        whileTap={{ scale: 0.985 }}
        whileHover={{ y: -1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        className="relative overflow-hidden bg-card/80 backdrop-blur-lg border border-border/50 rounded-2xl mb-2.5 shadow-[0_2px_10px_-6px_hsl(var(--foreground)/0.08)]"
      >
        <div className="p-3 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Store size={14} className="text-primary shrink-0" />
                <h3 className="text-sm font-semibold truncate">
                  Checkout · {kids.length} stores
                </h3>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{summary}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-sm font-semibold">{formatPrice(total)}</span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-1.5">
            {kids.map((o) => {
              const label = buyerStoreStatusLabel(o.status, o.payment_status);
              const seller = firstEmbed(o.seller as any) || o.seller;
              const name = seller?.business_name || 'Store';
              const img = o.items?.[0]?.product_image || seller?.cover_image_url;
              return (
                <div
                  key={o.id}
                  className="flex items-center gap-2 rounded-xl bg-muted/40 px-2 py-1.5"
                >
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                    {img ? (
                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <Package size={14} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{name}</p>
                    <p className={`text-[10px] ${statusTone(label)}`}>{label}</p>
                  </div>
                  <span className="text-[11px] font-medium shrink-0">
                    {formatPrice(o.total_amount)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
            <span>
              {paymentType === 'cod'
                ? 'Cash on delivery'
                : paymentType === 'wallet'
                  ? 'Sociva Credit'
                  : paymentType
                    ? 'Online payment'
                    : 'Checkout'}
            </span>
            {createdAt ? <span>{humanizeRelativeTime(createdAt)}</span> : null}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
