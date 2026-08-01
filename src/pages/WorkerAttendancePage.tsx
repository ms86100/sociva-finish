// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkerRole } from '@/hooks/useWorkerRole';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Clock, User, CheckCircle2, XCircle } from 'lucide-react';
import { format, subDays } from 'date-fns';

export default function WorkerAttendancePage() {
  const { effectiveSocietyId } = useAuth();
  const { workerProfile, isWorker } = useWorkerRole();
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: attendance = [], isLoading } = useQuery({
    queryKey: ['worker-attendance', effectiveSocietyId, dateFilter],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      let query = (supabase
        .from('worker_attendance')
        .select(`
          *,
          worker:society_workers!worker_attendance_worker_id_fkey(worker_type, phone, photo_url, status)
        `) as any)
        .eq('society_id', effectiveSocietyId)
        .eq('date', dateFilter)
        .order('check_in_at', { ascending: false });
      // Workers only see their own attendance
      if (isWorker && workerProfile) {
        query = query.eq('worker_id', workerProfile.id);
      }
      const { data } = await query;
      return data || [];
    },
    enabled: !!effectiveSocietyId,
  });

  // Also get all workers to show absent ones
  const { data: allWorkers = [] } = useQuery({
    queryKey: ['all-workers-active', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      const { data } = await supabase
        .from('society_workers')
        .select('id, worker_type, emergency_contact_phone, photo_url')
        .eq('society_id', effectiveSocietyId)
        .eq('status', 'active')
        .is('deactivated_at', null);
      return data || [];
    },
    enabled: !!effectiveSocietyId,
  });

  const presentWorkerIds = new Set(attendance.map((a: any) => a.worker_id));
  const absentWorkers = allWorkers.filter(w => !presentWorkerIds.has(w.id));

  const presentCount = attendance.length;
  const absentCount = absentWorkers.length;

  return (
    <AppLayout headerTitle="Worker Attendance" showLocation={false}>
      <FeatureGate feature="worker_attendance">
      <div className="p-4 space-y-4">
        {/* Date picker */}
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-primary" />
          <Input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            max={format(new Date(), 'yyyy-MM-dd')}
            min={format(subDays(new Date(), 30), 'yyyy-MM-dd')}
            className="flex-1"
          />
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-success/20 bg-success/5">
            <CardContent className="p-3 text-center">
              <CheckCircle2 className="mx-auto text-success mb-1" size={18} />
              <p className="text-lg font-bold tabular-nums">{presentCount}</p>
              <p className="text-[10px] text-muted-foreground">Present</p>
            </CardContent>
          </Card>
          <Card className="border-destructive/20 bg-destructive/5">
            <CardContent className="p-3 text-center">
              <XCircle className="mx-auto text-destructive mb-1" size={18} />
              <p className="text-lg font-bold tabular-nums">{absentCount}</p>
              <p className="text-[10px] text-muted-foreground">Absent</p>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
        ) : (
          <>
            {/* Present workers */}
            {attendance.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Present ({presentCount})</p>
                {attendance.map((record: any) => (
                  <Card key={record.id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      {record.worker?.photo_url ? (
                        <img src={record.worker.photo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                          <User size={16} className="text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm capitalize">{record.worker?.worker_type || 'Worker'}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <Clock size={10} />
                          <span>In: {format(new Date(record.check_in_at), 'hh:mm a')}</span>
                          {record.check_out_at && (
                            <span>· Out: {format(new Date(record.check_out_at), 'hh:mm a')}</span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] capitalize">{record.entry_method}</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Absent workers */}
            {absentWorkers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Absent ({absentCount})</p>
                {absentWorkers.map(worker => (
                  <Card key={worker.id} className="opacity-60">
                    <CardContent className="p-3 flex items-center gap-3">
                      {worker.photo_url ? (
                        <img src={worker.photo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                          <User size={16} className="text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="font-medium text-sm capitalize">{worker.worker_type}</p>
                        {worker.emergency_contact_phone && <p className="text-[10px] text-muted-foreground">{worker.emergency_contact_phone}</p>}
                      </div>
                      <Badge variant="destructive" className="text-[10px]">Absent</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {attendance.length === 0 && absentWorkers.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Calendar className="mx-auto mb-3" size={32} />
                <p className="text-sm">No attendance records</p>
              </div>
            )}
          </>
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
