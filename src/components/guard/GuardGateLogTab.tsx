// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Truck, QrCode, Wrench, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface GateLogEntry {
  entry_type: string;
  person_name: string;
  flat_number: string | null;
  status: string;
  entry_time: string;
  details: string | null;
}

interface Props {
  societyId: string;
}

const TYPE_ICONS: Record<string, typeof Users> = {
  visitor: Users,
  delivery: Truck,
  resident: QrCode,
  worker: Wrench,
};

const TYPE_COLORS: Record<string, string> = {
  visitor: 'bg-info/15 text-info',
  delivery: 'bg-warning/15 text-warning',
  resident: 'bg-success/15 text-success',
  worker: 'bg-primary/15 text-primary',
};

export function GuardGateLogTab({ societyId }: Props) {
  const [logs, setLogs] = useState<GateLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, [societyId]);

  const fetchLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_unified_gate_log', {
      _society_id: societyId,
      _date: new Date().toISOString().split('T')[0],
    });
    if (!error && data) {
      setLogs(data as unknown as GateLogEntry[]);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Clock className="mx-auto mb-3" size={32} />
        <p className="text-sm">No gate activity today</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">Today's Gate Activity</p>
      {logs.map((log, i) => {
        const Icon = TYPE_ICONS[log.entry_type] || Users;
        const colorClass = TYPE_COLORS[log.entry_type] || 'bg-muted text-muted-foreground';
        return (
          <Card key={i}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${colorClass}`}>
                <Icon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{log.person_name}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="text-[9px] capitalize">{log.entry_type}</Badge>
                  {log.flat_number && <span>Flat {log.flat_number}</span>}
                  {log.details && <span>{log.details}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <Badge variant="secondary" className="text-[9px] capitalize">{log.status.replace('_', ' ')}</Badge>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(log.entry_time), { addSuffix: true })}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
