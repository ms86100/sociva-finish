import { useSellerAccountability } from '@/hooks/useSellerAccountability';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export function SellerAccountabilityPanel() {
  const { data, isLoading } = useSellerAccountability();
  const qc = useQueryClient();

  const refresh = async () => {
    const { error } = await supabase.functions.invoke('update-seller-performance');
    if (error) toast.error('Refresh failed');
    else {
      toast.success('Recomputing metrics…');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['seller-performance-metrics'] }), 1500);
    }
  };

  const fmtSec = (s: number) => {
    if (!s) return '—';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${(s / 3600).toFixed(1)}h`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{data?.length ?? 0} sellers tracked (last 30 days)</div>
        <Button size="sm" variant="outline" onClick={refresh}>Recompute</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">Seller</th>
                  <th className="p-2">Avg response</th>
                  <th className="p-2">Orders 30d</th>
                  <th className="p-2">Missed</th>
                  <th className="p-2">Escalations</th>
                  <th className="p-2">Last active</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Loading…</td></tr>}
                {(data || []).map((m) => {
                  const flagged = m.escalation_hits > 20;
                  return (
                    <tr key={m.seller_id} className={`border-t ${flagged ? 'bg-destructive/5' : ''}`}>
                      <td className="p-2 font-medium">
                        {m.business_name || m.seller_id.slice(0, 8)}
                        {flagged && <Badge variant="destructive" className="ml-2">flagged</Badge>}
                      </td>
                      <td className="p-2">{fmtSec(m.avg_response_seconds)}</td>
                      <td className="p-2">{m.total_orders_30d}</td>
                      <td className="p-2">{m.missed_orders_count}</td>
                      <td className="p-2 font-semibold">{m.escalation_hits}</td>
                      <td className="p-2 text-muted-foreground">{m.last_active_at ? formatDistanceToNow(new Date(m.last_active_at), { addSuffix: true }) : '—'}</td>
                    </tr>
                  );
                })}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No seller metrics yet — click Recompute</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
