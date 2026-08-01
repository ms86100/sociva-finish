// @ts-nocheck
import { useStuckOrders } from '@/hooks/useStuckOrders';
import { useEngineRuns } from '@/hooks/useNotificationTemplates';
import { Badge } from '@/components/ui/badge';
import { Loader2, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

function formatElapsed(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function StuckOrdersPanel() {
  const { data: orders, isLoading } = useStuckOrders();
  const { data: runs } = useEngineRuns(5);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/40 p-3">
        <div className="text-xs font-semibold mb-2 text-muted-foreground">Engine activity (last 5 runs)</div>
        {!runs || runs.length === 0 ? (
          <div className="text-xs text-muted-foreground">No runs recorded yet.</div>
        ) : (
          <div className="space-y-1 text-xs">
            {runs.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between">
                <span>{new Date(r.started_at).toLocaleTimeString()}</span>
                <span className="text-muted-foreground">
                  {r.rules_evaluated} rules · {r.entities_scanned} scanned · {r.notifications_enqueued} sent
                  {r.errors > 0 && <span className="text-destructive ml-1">· {r.errors} errors</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/40 p-3">
        <div className="text-xs font-semibold mb-2 text-muted-foreground">Stuck orders</div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
        ) : !orders || orders.length === 0 ? (
          <div className="text-xs text-muted-foreground">No orders are currently overdue 🎉</div>
        ) : (
          <div className="space-y-1">
            {orders.map((o) => (
              <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between text-xs p-2 rounded-lg hover:bg-muted/40">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                  <code className="truncate">{o.id.slice(0, 8).toUpperCase()}</code>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatElapsed(o.elapsed_seconds)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
