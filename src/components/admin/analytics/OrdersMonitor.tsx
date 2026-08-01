// @ts-nocheck
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useOrdersMonitor } from '@/hooks/queries/useAdminAnalytics';
import { PAYMENT_STATUS_LABELS } from '@/types/database';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

const PAGE_SIZE = 20;

// Component needs to be inside function to use hooks
export function OrdersMonitor() {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const { getOrderStatus } = useStatusLabels();

  // Load distinct statuses from workflow engine
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('category_status_flows')
        .select('status_key');
      if (data) {
        const unique = [...new Set(data.map(d => d.status_key))].sort();
        setStatusOptions(unique);
      }
    })();
  }, []);

  const { data, isLoading } = useOrdersMonitor({
    status, paymentStatus, page, pageSize: PAGE_SIZE,
  });

  const totalPages = Math.ceil((data?.total || 0) / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold">Orders Monitor</h3>
        <div className="flex gap-2">
          <Select value={status} onValueChange={v => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-28 h-8 text-xs rounded-xl"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {statusOptions.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={paymentStatus} onValueChange={v => { setPaymentStatus(v); setPage(0); }}>
            <SelectTrigger className="w-28 h-8 text-xs rounded-xl"><SelectValue placeholder="Payment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payment</SelectItem>
              {['pending','paid','failed'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {data?.total !== undefined && (
        <p className="text-xs text-muted-foreground font-medium">{data.total} orders found</p>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : (
        <div className="space-y-2">
          {(data?.orders || []).map((order: any) => {
            const statusInfo = getOrderStatus(order.status);
            const payInfo = PAYMENT_STATUS_LABELS[order.payment_status as keyof typeof PAYMENT_STATUS_LABELS] || { label: order.payment_status, color: 'bg-muted text-muted-foreground' };
            const isOpen = expandedId === order.id;

            return (
              <Collapsible key={order.id} open={isOpen} onOpenChange={() => setExpandedId(isOpen ? null : order.id)}>
                <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <CardContent className="p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-bold text-muted-foreground">#{order.id.slice(0, 8)}</span>
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold', statusInfo.color)}>{statusInfo.label}</span>
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold', payInfo.color)}>{payInfo.label}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">{order.buyer?.name || '—'}</span>
                            <span>→</span>
                            <span className="font-semibold text-foreground">{order.seller?.business_name || '—'}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                            <span className="font-bold text-foreground">₹{order.total_amount}</span>
                            <span>{format(new Date(order.created_at), 'MMM d, h:mm a')}</span>
                          </div>
                        </div>
                        <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                      </div>
                    </CardContent>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 pb-3 border-t border-border/30 pt-2 space-y-2">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Order Items</p>
                      {(order.items || []).map((item: any) => (
                        <div key={item.id} className="flex justify-between text-xs">
                          <span>{item.product_name} × {item.quantity}</span>
                          <span className="font-semibold">₹{item.unit_price * item.quantity}</span>
                        </div>
                      ))}
                      <div className="border-t border-border/30 pt-2 mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                        <span>Buyer: {order.buyer?.name} ({order.buyer?.flat_number}, {order.buyer?.block})</span>
                        <span>Phone: {order.buyer?.phone}</span>
                        <span>Payment: {order.payment_type?.toUpperCase()}</span>
                        <span>Type: {order.order_type || 'purchase'}</span>
                        {order.delivery_address && <span className="col-span-2">Address: {order.delivery_address}</span>}
                        {order.notes && <span className="col-span-2">Notes: {order.notes}</span>}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button size="sm" variant="outline" className="h-8 w-8 p-0 rounded-xl" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></Button>
          <span className="text-xs font-semibold text-muted-foreground">{page + 1} / {totalPages}</span>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0 rounded-xl" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></Button>
        </div>
      )}
    </div>
  );
}
