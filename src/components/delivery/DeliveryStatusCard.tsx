// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Truck, Phone, MapPin, Key, CheckCircle, XCircle, Clock, Loader2, Package, Navigation, Home } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useSystemSettingsRaw } from '@/hooks/useSystemSettingsRaw';
import type { StatusFlowStep } from '@/hooks/useCategoryStatusFlow';

interface DeliveryAssignment {
  id: string;
  status: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_at: string | null;
  delivered_at: string | null;
  failed_reason: string | null;
  attempt_count: number;
  created_at: string;
}

interface DeliveryStatusCardProps {
  orderId: string;
  isBuyerView: boolean;
  showOtp?: boolean;
  /** Workflow flow steps — when provided, progress bar is derived dynamically */
  flow?: StatusFlowStep[];
}

interface StatusLabelConfig {
  label: string;
  buyer_msg?: string;
  seller_msg?: string;
  icon?: string;
  color?: string;
  buyer_emoji?: string;
  seller_emoji?: string;
}

const LUCIDE_ICON_MAP: Record<string, any> = {
  Clock, Truck, MapPin, CheckCircle, XCircle, Package, Navigation, Home, Loader2, Key, Phone,
};

const DEFAULT_ICON_MAP: Record<string, string> = {
  pending: 'Clock',
  assigned: 'Truck',
  picked_up: 'Truck',
  on_the_way: 'Navigation',
  at_gate: 'MapPin',
  delivered: 'CheckCircle',
  failed: 'XCircle',
  cancelled: 'XCircle',
};

const DEFAULT_COLOR_MAP: Record<string, string> = {
  pending: 'bg-warning/15 text-warning',
  assigned: 'bg-info/15 text-info',
  picked_up: 'bg-primary/15 text-primary',
  on_the_way: 'bg-primary/15 text-primary',
  at_gate: 'bg-info/15 text-info',
  delivered: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

const DEFAULT_LABELS: Record<string, StatusLabelConfig> = {
  pending: { label: 'Assigning Rider', buyer_msg: 'Finding a delivery partner for your order...', seller_msg: 'Assigning a delivery partner...' },
  assigned: { label: 'Rider Assigned', buyer_msg: 'will pick up your order soon.', seller_msg: 'assigned, will pick up soon.' },
  picked_up: { label: 'Out for Delivery', buyer_msg: 'Your order is on the way!', seller_msg: 'Rider has picked up the order.' },
  on_the_way: { label: 'On The Way', buyer_msg: 'Your order is on the way!', seller_msg: 'Rider is en route to the buyer.' },
  at_gate: { label: 'At Your Gate', buyer_msg: 'Delivery partner is at your society gate.', seller_msg: "Rider is at the buyer's gate." },
  delivered: { label: 'Delivered', buyer_msg: 'Your order has been delivered!', seller_msg: 'Delivery completed successfully.' },
  failed: { label: 'Delivery Failed', buyer_msg: '', seller_msg: 'Delivery failed. Check reason above.' },
  cancelled: { label: 'Cancelled', buyer_msg: '', seller_msg: '' },
};

const HARDCODED_DELIVERY_STEPS = ['pending', 'assigned', 'picked_up', 'on_the_way', 'at_gate', 'delivered'];

export function DeliveryStatusCard({ orderId, isBuyerView, showOtp, flow }: DeliveryStatusCardProps) {
  const [assignment, setAssignment] = useState<DeliveryAssignment | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const { getSetting } = useSystemSettingsRaw(['delivery_status_labels']);

  const labelsConfig = useMemo<Record<string, StatusLabelConfig>>(() => {
    try {
      const raw = getSetting('delivery_status_labels');
      if (raw) return { ...DEFAULT_LABELS, ...JSON.parse(raw) };
    } catch { /* use defaults */ }
    return DEFAULT_LABELS;
  }, [getSetting]);

  // Derive delivery progress steps from workflow flow (is_transit steps) or fallback to hardcoded
  const deliverySteps = useMemo(() => {
    if (flow && flow.length > 0) {
      const transitSteps = flow
        .filter(s => s.is_transit && !s.is_terminal)
        .map(s => s.status_key);
      // Add 'delivered' as the final step if it's a success terminal in the flow
      const deliveredStep = flow.find(s => s.status_key === 'delivered');
      if (deliveredStep && !transitSteps.includes('delivered')) {
        transitSteps.push('delivered');
      }
      if (transitSteps.length > 0) return transitSteps;
    }
    // Fallback: use labelsConfig keys minus terminal statuses, or hardcoded list
    const configKeys = Object.keys(labelsConfig).filter(k => !['failed', 'cancelled'].includes(k));
    return configKeys.length > 0 ? configKeys : HARDCODED_DELIVERY_STEPS;
  }, [flow, labelsConfig]);

  useEffect(() => {
    fetchAssignment();

    const channel = supabase
      .channel(`delivery-${orderId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'delivery_assignments',
        filter: `order_id=eq.${orderId}`,
      }, (payload) => {
        if (payload.new && (payload.new as any).id) {
          setAssignment(payload.new as DeliveryAssignment);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orderId]);

  const fetchAssignment = async () => {
    try {
      const { data, error } = await supabase
        .from('delivery_assignments')
        .select('id, status, rider_name, rider_phone, pickup_at, delivered_at, failed_reason, attempt_count, created_at')
        .eq('order_id', orderId)
        .maybeSingle();

      if (!error && data) {
        setAssignment(data as DeliveryAssignment);
      }
    } catch (err) {
      console.error('Error fetching delivery assignment:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
        <Loader2 className="animate-spin text-muted-foreground" size={16} />
        <span className="text-sm text-muted-foreground">Loading delivery info...</span>
      </div>
    );
  }

  if (!assignment) return null;

  const statusConfig = labelsConfig[assignment.status] || labelsConfig.pending || DEFAULT_LABELS.pending;
  const iconName = statusConfig.icon || DEFAULT_ICON_MAP[assignment.status] || 'Clock';
  const StatusIcon = LUCIDE_ICON_MAP[iconName] || Clock;
  const colorClass = statusConfig.color || DEFAULT_COLOR_MAP[assignment.status] || DEFAULT_COLOR_MAP.pending;

  const currentStepIndex = deliverySteps.indexOf(assignment.status);

  const buyerMsg = statusConfig.buyer_msg || '';
  const sellerMsg = statusConfig.seller_msg || '';
  const buyerEmoji = statusConfig.buyer_emoji || '';
  const sellerEmoji = statusConfig.seller_emoji || '';

  const displayBuyerMsg = assignment.status === 'assigned' && assignment.rider_name
    ? `${buyerEmoji || '✅'} ${assignment.rider_name} ${buyerMsg}`
    : buyerMsg ? `${buyerEmoji} ${buyerMsg}`.trim() : '';
  const displaySellerMsg = assignment.status === 'assigned' && assignment.rider_name
    ? `${sellerEmoji || '🚴'} ${assignment.rider_name} ${sellerMsg}`
    : sellerMsg ? `${sellerEmoji} ${sellerMsg}`.trim() : '';

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck size={16} className="text-primary" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivery</p>
        </div>
        <Badge variant="secondary" className={colorClass}>
          {statusConfig.label}
        </Badge>
      </div>

      {!['failed', 'cancelled'].includes(assignment.status) && (
        <div className="flex items-center gap-1">
          {deliverySteps.map((step, index) => (
            <div key={step} className="flex items-center flex-1">
              <div className={`h-1.5 rounded-full flex-1 ${
                index <= currentStepIndex ? 'bg-primary' : 'bg-muted'
              }`} />
            </div>
          ))}
        </div>
      )}

      {assignment.rider_name && (
        <div className="flex items-center justify-between bg-muted/50 rounded-lg p-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Truck size={14} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{assignment.rider_name}</p>
              <p className="text-[11px] text-muted-foreground">Delivery Partner</p>
            </div>
          </div>
          {assignment.rider_phone && (
            <a href={`tel:${assignment.rider_phone}`} className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
              <Phone size={14} className="text-accent" />
            </a>
          )}
        </div>
      )}

      {isBuyerView && (() => {
        // Strictly workflow-driven: only show OTP hint when the workflow says the next step requires OTP.
        // No hardcoded status fallbacks — OTP behavior is owned by the Workflow editor.
        if (!flow || flow.length === 0) return false;
        const currentIdx = flow.findIndex(s => s.status_key === assignment.status);
        const nextStep = currentIdx >= 0 && currentIdx < flow.length - 1 ? flow[currentIdx + 1] : null;
        return !!nextStep?.requires_otp;
      })() && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-center gap-3">
          <Key size={18} className="text-primary shrink-0" />
          <div>
            <p className="text-xs font-semibold text-primary">Delivery OTP</p>
            <p className="text-[11px] text-muted-foreground">Share this with the delivery partner</p>
            <p className="text-xs text-muted-foreground mt-0.5">Check your notifications for the OTP code</p>
          </div>
        </div>
      )}

      {assignment.status === 'failed' && assignment.failed_reason && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2.5">
          <p className="text-xs text-destructive">{assignment.failed_reason}</p>
        </div>
      )}

      {assignment.status === 'failed' && isBuyerView && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-2">
          <p className="text-xs text-destructive font-medium">Delivery could not be completed</p>
          <p className="text-[11px] text-muted-foreground">You can raise a dispute for a refund or contact support.</p>
          <a href="/disputes" className="inline-flex items-center text-xs font-medium text-primary hover:underline">
            Raise a Dispute →
          </a>
        </div>
      )}

      {isBuyerView && displayBuyerMsg && (
        <p className="text-xs text-muted-foreground">{displayBuyerMsg}</p>
      )}
      {!isBuyerView && displaySellerMsg && (
        <p className="text-xs text-muted-foreground">{displaySellerMsg}</p>
      )}
    </div>
  );
}
