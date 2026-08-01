// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Truck, Clock, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { useCurrency } from '@/hooks/useCurrency';

interface DeliveryRecord {
  id: string;
  order_id: string;
  status: string;
  rider_name: string | null;
  rider_phone: string | null;
  delivery_fee: number;
  created_at: string;
  pickup_at: string | null;
  delivered_at: string | null;
  failed_reason: string | null;
}

interface DeliveryMonitoringTabProps {
  societyId?: string;
}

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-warning/15 text-warning' },
  assigned: { label: 'Assigned', color: 'bg-info/15 text-info' },
  picked_up: { label: 'In Transit', color: 'bg-primary/15 text-primary' },
  at_gate: { label: 'At Gate', color: 'bg-accent text-accent-foreground' },
  delivered: { label: 'Delivered', color: 'bg-success/15 text-success' },
  failed: { label: 'Failed', color: 'bg-destructive/15 text-destructive' },
  cancelled: { label: 'Cancelled', color: 'bg-muted text-muted-foreground' },
};

export function DeliveryMonitoringTab({ societyId }: DeliveryMonitoringTabProps) {
  const { getDeliveryStatus } = useStatusLabels();
  const { formatPrice } = useCurrency();
  const [allDeliveries, setAllDeliveries] = useState<DeliveryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'completed' | 'failed'>('active');

  useEffect(() => {
    fetchDeliveries();
  }, [societyId]);

  const fetchDeliveries = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('delivery_assignments')
        .select('id, order_id, status, rider_name, rider_phone, delivery_fee, created_at, pickup_at, delivered_at, failed_reason')
        .order('created_at', { ascending: false })
        .limit(100);

      if (societyId) {
        query = query.eq('society_id', societyId);
      }

      const { data, error } = await query;
      if (!error) setAllDeliveries((data || []) as DeliveryRecord[]);
    } catch (err) {
      console.error('Error fetching deliveries:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const stats = {
    active: allDeliveries.filter(d => ['pending', 'assigned', 'picked_up', 'at_gate'].includes(d.status)).length,
    delivered: allDeliveries.filter(d => d.status === 'delivered').length,
    failed: allDeliveries.filter(d => ['failed', 'cancelled'].includes(d.status)).length,
  };

  const deliveries = allDeliveries.filter(d => {
    if (filter === 'active') return ['pending', 'assigned', 'picked_up', 'at_gate'].includes(d.status);
    if (filter === 'completed') return d.status === 'delivered';
    return ['failed', 'cancelled'].includes(d.status);
  });

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-info/10 rounded-xl p-3 text-center">
          <Truck className="mx-auto text-info mb-1" size={18} />
          <p className="text-lg font-bold tabular-nums text-info">{stats.active}</p>
          <p className="text-[10px] text-info/80">Active</p>
        </div>
        <div className="bg-success/10 rounded-xl p-3 text-center">
          <CheckCircle className="mx-auto text-success mb-1" size={18} />
          <p className="text-lg font-bold tabular-nums text-success">{stats.delivered}</p>
          <p className="text-[10px] text-success/80">Delivered</p>
        </div>
        <div className="bg-destructive/10 rounded-xl p-3 text-center">
          <XCircle className="mx-auto text-destructive mb-1" size={18} />
          <p className="text-lg font-bold tabular-nums text-destructive">{stats.failed}</p>
          <p className="text-[10px] text-destructive/80">Failed</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['active', 'completed', 'failed'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 min-h-[40px] rounded-lg text-xs font-medium transition-colors ${
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={fetchDeliveries}>
          <RefreshCw size={14} />
        </Button>
      </div>

      {/* Delivery list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : deliveries.length === 0 ? (
        <div className="text-center py-8">
          <Truck className="mx-auto text-muted-foreground mb-2" size={32} />
          <p className="text-sm text-muted-foreground">No {filter} deliveries</p>
        </div>
      ) : (
        <div className="space-y-2">
          {deliveries.map(delivery => {
            const statusConfig = getDeliveryStatus(delivery.status);
            return (
              <div key={delivery.id} className="bg-card border border-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-mono text-muted-foreground">
                    #{delivery.order_id.slice(0, 8)}
                  </span>
                  <Badge variant="secondary" className={`text-[10px] ${statusConfig.color}`}>
                    {statusConfig.label}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    {delivery.rider_name && (
                      <p className="text-sm font-medium">{delivery.rider_name}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(delivery.created_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                  {delivery.delivery_fee > 0 && (
                    <span className="text-sm font-semibold">{formatPrice(delivery.delivery_fee)}</span>
                  )}
                </div>
                {delivery.failed_reason && (
                  <div className="mt-1.5 flex items-start gap-1.5">
                    <AlertTriangle size={12} className="text-destructive shrink-0 mt-0.5" />
                    <p className="text-[11px] text-destructive">{delivery.failed_reason}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
