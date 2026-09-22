// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, Smartphone, AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adminNotify } from '@/lib/admin-notify';
import { useState } from 'react';
import { friendlyError } from '@/lib/utils';

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
    staleTime: 2 * 60_000,
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
    staleTime: 2 * 60_000,
  });

  const handleProcessNow = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-notification-queue');
      if (error) throw error;
      adminNotify.success(`Processed: ${data?.processed || 0}, Retried: ${data?.retried || 0}`);
    } catch (err: any) {
      adminNotify.error(friendlyError(err) || 'Failed to process queue');
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

      <PermissionHealthPanel />
    </div>
  );
}

function PermissionHealthPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-permission-health'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_permission_health_summary');
      if (error) throw error;
      return data as {
        total_installations?: number;
        notification?: Record<string, number>;
        location?: Record<string, number>;
        claimed_users_notif_off?: number;
        claimed_users_location_off?: number;
        claimed_users_both_off?: number;
      };
    },
    staleTime: 2 * 60_000,
    retry: false,
  });

  return (
    <div className="pt-3 border-t border-border/60 space-y-2">
      <div className="flex items-center gap-2">
        <Smartphone size={14} className="text-primary" />
        <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Permission Health</h4>
      </div>
      {error ? (
        <p className="text-[11px] text-muted-foreground">
          Installations metrics unavailable until migration is applied.
        </p>
      ) : isLoading ? (
        <p className="text-[11px] text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-muted/40 px-2.5 py-2">
            <p className="font-extrabold tabular-nums text-sm">{data?.total_installations ?? 0}</p>
            <p className="text-muted-foreground">Installations</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2">
            <p className="font-extrabold tabular-nums text-sm">{data?.notification?.enabled ?? 0}</p>
            <p className="text-muted-foreground">Notif enabled</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2">
            <p className="font-extrabold tabular-nums text-sm">{data?.notification?.denied ?? 0}</p>
            <p className="text-muted-foreground">Notif denied</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2">
            <p className="font-extrabold tabular-nums text-sm">{data?.notification?.not_requested ?? 0}</p>
            <p className="text-muted-foreground">Notif not asked</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2">
            <p className="font-extrabold tabular-nums text-sm">{data?.location?.enabled ?? 0}</p>
            <p className="text-muted-foreground">Loc enabled</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2">
            <p className="font-extrabold tabular-nums text-sm">{data?.location?.denied ?? 0}</p>
            <p className="text-muted-foreground">Loc denied</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2 col-span-2">
            <p className="text-muted-foreground">
              Users notif off: <span className="font-bold text-foreground">{data?.claimed_users_notif_off ?? 0}</span>
              {' · '}
              location off: <span className="font-bold text-foreground">{data?.claimed_users_location_off ?? 0}</span>
              {' · '}
              both off: <span className="font-bold text-foreground">{data?.claimed_users_both_off ?? 0}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
