import { useState } from 'react';
import { useNotificationAudit } from '@/hooks/useNotificationAudit';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';

export function NotificationAuditPanel() {
  const { data, isLoading } = useNotificationAudit(200);
  const [q, setQ] = useState('');

  const rows = (data || []).filter((r) =>
    !q ||
    r.rule_key?.toLowerCase().includes(q.toLowerCase()) ||
    r.entity_id.toLowerCase().includes(q.toLowerCase()) ||
    r.status.toLowerCase().includes(q.toLowerCase()),
  );

  const total = data?.length || 0;
  const delivered = (data || []).filter((r) => r.delivered_at).length;
  const read = (data || []).filter((r) => r.read_at).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Triggered</div><div className="text-lg font-semibold">{total}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Delivered</div><div className="text-lg font-semibold">{delivered}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Read</div><div className="text-lg font-semibold">{read}</div></CardContent></Card>
      </div>

      <Input placeholder="Filter by rule key, entity id, or status…" value={q} onChange={(e) => setQ(e.target.value)} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[480px]">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="p-2">Triggered</th>
                  <th className="p-2">Rule</th>
                  <th className="p-2">L</th>
                  <th className="p-2">Entity</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Delivered</th>
                  <th className="p-2">Read</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Loading…</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{formatDistanceToNow(new Date(r.triggered_at), { addSuffix: true })}</td>
                    <td className="p-2 font-mono">{r.rule_key || '—'}</td>
                    <td className="p-2"><Badge variant="outline">{r.escalation_level}</Badge></td>
                    <td className="p-2 font-mono text-[10px]">{r.entity_id.slice(0, 8)}</td>
                    <td className="p-2"><Badge variant={r.status === 'read' ? 'default' : r.status === 'delivered' ? 'secondary' : 'outline'}>{r.status}</Badge></td>
                    <td className="p-2 text-muted-foreground">{r.delivered_at ? '✓' : '—'}</td>
                    <td className="p-2 text-muted-foreground">{r.read_at ? '✓' : '—'}</td>
                  </tr>
                ))}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No audit rows</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
