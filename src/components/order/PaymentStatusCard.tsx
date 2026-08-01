// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import { CreditCard, CheckCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';
import { cardEntrance } from '@/lib/motion-variants';

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  completed: { label: 'Payment received', icon: CheckCircle, color: 'text-accent' },
  confirmed: { label: 'Payment confirmed', icon: CheckCircle, color: 'text-accent' },
  buyer_confirmed: { label: 'Awaiting seller verification', icon: Clock, color: 'text-warning' },
  seller_verified: { label: 'Payment verified', icon: CheckCircle, color: 'text-accent' },
  paid: { label: 'Payment received', icon: CheckCircle, color: 'text-accent' },
  pending: { label: 'Payment pending', icon: Clock, color: 'text-warning' },
  failed: { label: 'Payment failed', icon: AlertTriangle, color: 'text-destructive' },
  refund_initiated: { label: 'Refund initiated', icon: RefreshCw, color: 'text-warning' },
  refund_processing: { label: 'Refund processing', icon: RefreshCw, color: 'text-warning' },
  refunded: { label: 'Refund credited', icon: CheckCircle, color: 'text-accent' },
};

const METHOD_LABELS: Record<string, string> = {
  cod: 'Cash on Delivery',
  upi: 'UPI Payment',
  card: 'Online Payment',
  razorpay: 'Online Payment',
};

interface PaymentStatusCardProps {
  orderId: string;
  paymentType?: string;
  totalAmount: number;
  orderStatus: string;
  /** Payment status from the orders table — used as fallback when no payment_records row exists */
  orderPaymentStatus?: string | null;
}

export function PaymentStatusCard({ orderId, paymentType, totalAmount, orderStatus, orderPaymentStatus }: PaymentStatusCardProps) {
  const { formatPrice } = useCurrency();

  const { data: paymentRecord } = useQuery({
    queryKey: ['payment-record', orderId],
    queryFn: async () => {
      const { data } = await supabase
        .from('payment_records')
        .select('id, amount, payment_method, payment_status, transaction_reference, created_at, updated_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 2 * 60_000,
  });

  const { data: dispute } = useQuery({
    queryKey: ['dispute-for-order', orderId],
    queryFn: async () => {
      const { data } = await supabase
        .from('dispute_tickets')
        .select('id, status, resolution, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 2 * 60_000,
  });

  // Prefer payment_records (most detailed), fall back to orders.payment_status
  // (legacy orders + COD orders may not have a payment_records row).
  const paymentStatus =
    paymentRecord?.payment_status ||
    orderPaymentStatus ||
    'pending';
  const config = STATUS_CONFIG[paymentStatus] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  const isCancelled = ['cancelled', 'rejected'].includes(orderStatus);
  const refundStatus = isCancelled && paymentRecord && paymentType !== 'cod'
    ? paymentRecord.payment_status
    : null;
  
  const isRefundState = refundStatus && ['refund_initiated', 'refund_processing', 'refunded'].includes(refundStatus);
  const refundConfig = isRefundState ? STATUS_CONFIG[refundStatus] : null;

  const getRefundStep = (status: string | null): number => {
    if (!status) return 0;
    if (status === 'refund_initiated') return 1;
    if (status === 'refund_processing') return 2;
    if (status === 'refunded') return 3;
    return 0;
  };
  const refundStep = getRefundStep(refundStatus);

  return (
    <motion.div
      variants={cardEntrance}
      initial="hidden"
      animate="show"
      className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-4 shadow-sm"
    >
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Payment</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn("p-1.5 rounded-lg bg-muted", config.color)}>
            <Icon size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold">{formatPrice(paymentRecord?.amount ?? totalAmount)}</p>
            <p className="text-[11px] text-muted-foreground">
              {METHOD_LABELS[paymentRecord?.payment_method || paymentType || ''] || paymentType || 'Payment'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className={cn("text-xs font-medium", config.color)}>
            {config.label}
          </span>
          {paymentRecord?.transaction_reference && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Ref: {paymentRecord.transaction_reference.slice(-8)}
            </p>
          )}
        </div>
      </div>

      {refundConfig && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <RefreshCw size={14} className={refundConfig.color} />
            <span className={cn("text-xs font-medium", refundConfig.color)}>
              {refundConfig.label}
            </span>
          </div>
          <div className="flex gap-1 mt-2">
            {['Initiated', 'Processing', 'Credited'].map((step, i) => {
              const active = refundStep > i;
              return (
                <div key={step} className="flex-1">
                  <motion.div
                    className={cn("h-1 rounded-full", active ? "bg-accent" : "bg-muted")}
                    initial={false}
                    animate={{ scaleX: active ? 1 : 0.3, opacity: active ? 1 : 0.4 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                    style={{ originX: 0 }}
                  />
                  <p className="text-[9px] text-muted-foreground mt-1 text-center">{step}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isCancelled && paymentType !== 'cod' && !isRefundState && paymentRecord && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Refund will be processed within 5-7 business days
            </span>
          </div>
        </div>
      )}

      {dispute && (
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
          <AlertTriangle size={14} className="text-warning" />
          <div>
            <p className="text-xs font-medium">Dispute: {dispute.status}</p>
            {dispute.resolution && (
              <p className="text-[11px] text-muted-foreground">{dispute.resolution}</p>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
