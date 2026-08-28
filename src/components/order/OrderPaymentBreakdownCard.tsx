// @ts-nocheck
import { CreditCard, Banknote, Wallet } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import {
  computeOrderPaymentBreakdown,
  type OrderPaymentBreakdown,
} from '@/lib/order-payment-breakdown';
import { motion } from 'framer-motion';
import { cardEntrance } from '@/lib/motion-variants';

interface OrderPaymentBreakdownCardProps {
  order: {
    total_amount?: number | null;
    frozen_total?: number | null;
    wallet_cash_amount?: number | null;
    wallet_promo_amount?: number | null;
    loyalty_discount_amount?: number | null;
    coupon_discount?: number | null;
    payment_type?: string | null;
    payment_method?: string | null;
    payment_status?: string | null;
  };
  settlementNet?: number | null;
  settlementStatus?: string | null;
  compact?: boolean;
  title?: string;
  breakdown?: OrderPaymentBreakdown;
}

export function OrderPaymentBreakdownCard({
  order,
  settlementNet,
  settlementStatus,
  compact = false,
  title = 'Payment breakdown',
  breakdown: breakdownProp,
}: OrderPaymentBreakdownCardProps) {
  const { formatPrice } = useCurrency();
  const b = breakdownProp || computeOrderPaymentBreakdown(order);

  const rows: { label: string; value: number; icon?: any; emphasis?: boolean }[] = [
    { label: 'Order value', value: b.orderValue, emphasis: true },
  ];

  if (b.socivaBalance > 0) {
    rows.push({ label: 'Sociva Balance', value: b.socivaBalance, icon: Wallet });
  }
  if (b.loyaltyDiscount > 0) {
    rows.push({ label: 'Loyalty', value: b.loyaltyDiscount });
  }
  if (b.onlinePayment > 0) {
    rows.push({ label: 'Online payment', value: b.onlinePayment, icon: CreditCard });
  }
  if (b.cashToCollect > 0) {
    rows.push({ label: 'Cash to collect', value: b.cashToCollect, icon: Banknote });
  }

  return (
    <motion.div
      variants={cardEntrance}
      className={`bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl shadow-sm ${
        compact ? 'px-3 py-2.5 space-y-2' : 'px-4 py-3 space-y-3'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>{title}</p>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {b.paymentTypeLabel}
        </span>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="flex items-center justify-between text-sm">
              <span className={`flex items-center gap-1.5 ${row.emphasis ? 'font-medium' : 'text-muted-foreground text-xs'}`}>
                {Icon && <Icon size={12} className="text-muted-foreground shrink-0" />}
                {row.label}
              </span>
              <span className={`tabular-nums ${row.emphasis ? 'font-bold' : 'font-medium'}`}>
                {formatPrice(row.value)}
              </span>
            </div>
          );
        })}
      </div>

      {settlementNet != null && (
        <div className="pt-2 border-t border-border/50 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Seller settlement (net)</span>
          <div className="text-right">
            <p className="text-sm font-bold tabular-nums">{formatPrice(settlementNet)}</p>
            {settlementStatus && (
              <p className="text-[10px] text-muted-foreground capitalize">{settlementStatus.replace(/_/g, ' ')}</p>
            )}
          </div>
        </div>
      )}

      {order.payment_status && (
        <p className="text-[10px] text-muted-foreground">
          Payment status: <span className="capitalize">{String(order.payment_status).replace(/_/g, ' ')}</span>
        </p>
      )}
    </motion.div>
  );
}
