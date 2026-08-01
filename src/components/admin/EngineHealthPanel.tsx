import { useEngineHealth } from '@/hooks/useEngineHealth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

export function EngineHealthPanel() {
  const { data, isLoading } = useEngineHealth();

  if (isLoading) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">Loading engine activity…</CardContent></Card>;
  }

  const runs = data || [];
  const last = runs[0];
  const lastRunAgoMs = last ? Date.now() - new Date(last.started_at).getTime() : Infinity;
  const stale = lastRunAgoMs > 3 * 60 * 1000;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          {stale ? (
            <AlertTriangle className="text-destructive" size={20} />
          ) : (
            <CheckCircle2 className="text-green-600" size={20} />
          )}
          <div className="flex-1">
            <div className="text-sm font-semibold">
              {stale ? 'Engine stale' : 'Engine healthy'}
            </div>
            <div className="text-xs text-muted-foreground">
              Last run: {last ? formatDistanceToNow(new Date(last.started_at), { addSuffix: true }) : 'never'}
            </div>
          </div>
          <Badge variant={stale ? 'destructive' : 'secondary'}>
            {runs.length} runs (last 20)
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">Started</th>
                  <th className="p-2">Rules</th>
                  <th className="p-2">Scanned</th>
                  <th className="p-2">Enqueued</th>
                  <th className="p-2">Errors</th>
                  <th className="p-2">Lock</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}</td>
                    <td className="p-2">{r.rules_evaluated}</td>
                    <td className="p-2">{r.entities_scanned}</td>
                    <td className="p-2 font-semibold">{r.notifications_enqueued}</td>
                    <td className={r.errors > 0 ? 'p-2 text-destructive' : 'p-2'}>{r.errors}</td>
                    <td className="p-2">
                      {r.locked ? <Badge variant="outline">skipped</Badge> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No engine runs yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
