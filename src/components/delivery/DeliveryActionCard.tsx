// @ts-nocheck
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, MapPin, Phone, Clock, Navigation, ShieldCheck, Package } from 'lucide-react';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { useCurrency } from '@/hooks/useCurrency';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { StatusFlowStep } from '@/hooks/useCategoryStatusFlow';

/** Fetch the delivery-relevant workflow steps for an order */
function useDeliveryWorkflow(orderId: string | undefined) {
  return useQuery({
    queryKey: ['delivery-workflow', orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data: order } = await supabase
        .from('orders')
        .select('seller_id, fulfillment_type, delivery_handled_by, order_type, seller:seller_profiles!orders_seller_id_fkey(primary_group), items:order_items(product_id)')
        .eq('id', orderId)
        .single();
      if (!order) return null;

      const parentGroup = (order as any)?.seller?.primary_group || 'default';
      // Use the stored transaction_type from the order (set at creation) — single source of truth
      const txnType = (order as any)?.transaction_type || 'cart_purchase';

      const { data: steps } = await supabase
        .from('category_status_flows')
        .select('status_key, sort_order, actor, is_terminal, is_success, requires_otp, is_transit, otp_type, display_label, color, icon, buyer_hint, is_deprecated, creates_tracking_assignment')
        .eq('parent_group', parentGroup)
        .eq('transaction_type', txnType)
        .order('sort_order');

      return steps as StatusFlowStep[] | null;
    },
    enabled: !!orderId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Get the next delivery action for the current status from the workflow */
function getNextDeliveryAction(flow: StatusFlowStep[] | null | undefined, currentStatus: string): { nextStatus: string; otpType: string | null } | null {
  if (!flow || flow.length === 0) return null;

  const transitSteps = flow.filter(s => s.is_transit || s.status_key === 'assigned');
  const currentIdx = transitSteps.findIndex(s => s.status_key === currentStatus);
  if (currentIdx < 0) return null;
  const nextStep = currentIdx < transitSteps.length - 1 ? transitSteps[currentIdx + 1] : null;
  if (!nextStep) {
    const terminalSuccessStep = flow.find(s => s.is_terminal && s.is_success);
    return terminalSuccessStep ? { nextStatus: terminalSuccessStep.status_key, otpType: terminalSuccessStep.otp_type || null } : null;
  }
  return { nextStatus: nextStep.status_key, otpType: nextStep.otp_type || null };
}

/** Check if delivery is in-transit based on workflow — no hardcoded fallbacks */
export function isDeliveryInTransit(flow: StatusFlowStep[] | null | undefined, status: string): boolean {
  if (!flow || flow.length === 0) return false;
  return flow.some(s => s.status_key === status && s.is_transit);
}

interface DeliveryActionCardProps {
  delivery: any;
  updatingId: string | null;
  onUpdateStatus: (assignmentId: string, newStatus: string) => void;
  onOtpVerify: (orderId: string) => void;
  /** Callback when transit state is detected — used for GPS tracking */
  onTransitDetected?: (assignmentId: string, isTransit: boolean) => void;
}

export function DeliveryActionCard({ delivery, updatingId, onUpdateStatus, onOtpVerify, onTransitDetected }: DeliveryActionCardProps) {
  const { getDeliveryStatus } = useStatusLabels();
  const { formatPrice } = useCurrency();
  const { data: flow } = useDeliveryWorkflow(delivery.order?.id);
  const sc = getDeliveryStatus(delivery.status);

  // Notify parent about transit state for GPS tracking
  const inTransit = isDeliveryInTransit(flow, delivery.status);
  if (onTransitDetected) {
    onTransitDetected(delivery.id, inTransit);
  }

  const action = getNextDeliveryAction(flow, delivery.status);

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm">{delivery.order?.seller?.business_name || 'Order'}</p>
          <Badge variant="outline" className={`text-[10px] ${sc.color}`}>{sc.label}</Badge>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1">
            <MapPin size={12} /> {delivery.order?.buyer?.block}-{delivery.order?.buyer?.flat_number}
          </p>
          {delivery.order?.buyer?.phone && (
            <p className="flex items-center gap-1">
              <Phone size={12} /> {delivery.order.buyer.phone}
            </p>
          )}
          <p className="flex items-center gap-1 tabular-nums">
            <Clock size={12} /> {format(new Date(delivery.created_at), 'dd MMM, hh:mm a')}
          </p>
          {delivery.delivery_code && delivery.status !== 'delivered' && (
            <p className="text-primary font-mono font-bold">
              OTP: {delivery.delivery_code}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="tabular-nums">{formatPrice(delivery.order?.total_amount || 0)}</span>
          <span className="text-success font-medium tabular-nums">Fee: {formatPrice(delivery.delivery_fee)}</span>
        </div>

        {/* Action Buttons — workflow-driven, uses otp_type */}
        {action && (() => {
          const isDeliveryOtp = action.otpType === 'delivery';
          if (isDeliveryOtp && delivery.delivery_code) {
            return (
              <Button
                size="sm"
                className="w-full"
                onClick={() => onOtpVerify(delivery.order?.id)}
                disabled={updatingId === delivery.id}
              >
                <ShieldCheck size={14} className="mr-1" />
                Verify & Deliver
              </Button>
            );
          }
          const otpAction = getNextDeliveryAction(flow, action.nextStatus);
          const nextIsDeliveryOtp = otpAction?.otpType === 'delivery';
          return (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={nextIsDeliveryOtp ? 'outline' : 'default'}
                className="flex-1"
                onClick={() => onUpdateStatus(delivery.id, action.nextStatus)}
                disabled={updatingId === delivery.id}
              >
                {updatingId === delivery.id ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Navigation size={14} className="mr-1" />}
                {action.nextStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </Button>
              {nextIsDeliveryOtp && (
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => onOtpVerify(delivery.order?.id)}
                  disabled={updatingId === delivery.id}
                >
                  <ShieldCheck size={14} className="mr-1" />
                  Verify & Deliver
                </Button>
              )}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
