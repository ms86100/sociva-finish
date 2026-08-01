import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, Smartphone, AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useState } from 'react';

export function NotificationDiagnostics() {
  const [processing, setProcessing] = useState(false);

  const { data: tokenCount = 0, isLoading: loadingTokens } = useQuery({
    queryKey: ['admin-device-token-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('device_tokens')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },
    staleTime: 30_000,
  });

  const { data: queueStats, isLoading: loadingQueue } = useQuery({
    queryKey: ['admin-notification-queue-stats'],
    queryFn: async () => {
      const [pending, retrying, failed] = await Promise.all([
        supabase.from('notification_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('notification_queue').select('id', { count: 'exact', head: true }).eq('status', 'retrying'),
        supabase.from('notification_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      ]);
      return {
        pending: pending.count || 0,
        retrying: retrying.count || 0,
        failed: failed.count || 0,
      };
    },
    staleTime: 30_000,
  });

  const handleProcessNow = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-notification-queue');
      if (error) throw error;
      toast.success(`Processed: ${data?.processed || 0}, Retried: ${data?.retried || 0}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to process queue');
    } finally {
      setProcessing(false);
    }
  };

  const isLoading = loadingTokens || loadingQueue;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Bell size={15} className="text-primary" />
        <h4 className="text-sm font-bold text-foreground">Notification System</h4>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Smartphone size={15} className="text-blue-600" />
            </div>
            <div>
              <p className="text-lg font-extrabold tabular-nums">{isLoading ? '…' : tokenCount}</p>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Devices</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Clock size={15} className="text-amber-600" />
            </div>
            <div>
              <p className="text-lg font-extrabold tabular-nums">{isLoading ? '…' : queueStats?.pending}</p>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Pending</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {queueStats && queueStats.retrying > 0 && (
          <Badge variant="outline" className="text-xs gap-1">
            <AlertTriangle size={10} /> {queueStats.retrying} retrying
          </Badge>
        )}
        {queueStats && queueStats.failed > 0 && (
          <Badge variant="destructive" className="text-xs gap-1">
            {queueStats.failed} failed
          </Badge>
        )}
        {tokenCount === 0 && !isLoading && (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1">
            <AlertTriangle size={10} /> No devices registered
          </Badge>
        )}
        {tokenCount > 0 && queueStats?.pending === 0 && !isLoading && (
          <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 gap-1">
            <CheckCircle2 size={10} /> Healthy
          </Badge>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full rounded-xl text-xs font-semibold"
        onClick={handleProcessNow}
        disabled={processing}
      >
        {processing ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Bell size={14} className="mr-1.5" />}
        Process Queue Now
      </Button>
    </div>
  );
}
