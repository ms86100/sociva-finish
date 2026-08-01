// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkerRole } from '@/hooks/useWorkerRole';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { toast } from 'sonner';
import { CalendarOff, Plus, Loader2, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface WorkerOption {
  id: string;
  worker_type: string;
  profile?: { name: string } | null;
}

export default function WorkerLeavePage() {
  const { effectiveSocietyId, isSocietyAdmin, isAdmin, user, profile } = useAuth();
  const { workerProfile, isWorker } = useWorkerRole();
  const [leaves, setLeaves] = useState<any[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [workerId, setWorkerId] = useState('');
  const [leaveDate, setLeaveDate] = useState(new Date().toISOString().split('T')[0]);
  const [leaveType, setLeaveType] = useState('absent');
  const [reason, setReason] = useState('');

  const canManage = isSocietyAdmin || isAdmin;

  useEffect(() => {
    if (effectiveSocietyId) fetchData();
  }, [effectiveSocietyId]);

  const fetchData = async () => {
    setLoading(true);
    let leaveQuery = supabase.from('worker_leave_records')
      .select('*')
      .eq('society_id', effectiveSocietyId!)
      .order('leave_date', { ascending: false })
      .limit(100);
    
    // Workers only see their own leave
    if (isWorker && workerProfile) {
      leaveQuery = leaveQuery.eq('worker_id', workerProfile.id);
    }
    
    const [{ data: leaveData }, { data: workerData }] = await Promise.all([
      leaveQuery,
      supabase.from('society_workers')
        .select('id, worker_type, user_id')
        .eq('society_id', effectiveSocietyId!)
        .is('deactivated_at', null)
        .eq('status', 'active'),
    ]);

    // Fetch profile names for workers
    const workerList = (workerData || []) as any[];
    const userIds = workerList.map(w => w.user_id).filter(Boolean);
    let profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', userIds);
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p.name; });
    }

    const enrichedWorkers = workerList.map(w => ({
      ...w,
      profile: { name: profileMap[w.user_id] || w.worker_type },
    }));

    // Enrich leaves with worker info
    const workerMap: Record<string, any> = {};
    enrichedWorkers.forEach(w => { workerMap[w.id] = w; });
    const enrichedLeaves = ((leaveData || []) as any[]).map(l => ({
      ...l,
      worker: workerMap[l.worker_id],
    }));

    setLeaves(enrichedLeaves);
    setWorkers(enrichedWorkers);
    setLoading(false);
  };

  const handleAdd = async () => {
    const writeSocietyId = profile?.society_id || effectiveSocietyId;
    if (!workerId || !writeSocietyId || !user) return;
    setSubmitting(true);
    const { error } = await supabase.from('worker_leave_records').insert({
      worker_id: workerId,
      society_id: writeSocietyId,
      leave_date: leaveDate,
      leave_type: leaveType,
      reason: reason.trim() || null,
      marked_by: user.id,
    });
    if (error) toast.error('Failed to record leave');
    else { toast.success('Leave recorded'); setSheetOpen(false); setReason(''); fetchData(); }
    setSubmitting(false);
  };

  const getWorkerLabel = (w: WorkerOption) => w.profile?.name || w.worker_type;

  if (loading) return (
    <AppLayout headerTitle="Worker Leave" showLocation={false}>
      <div className="p-4 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
    </AppLayout>
  );

  return (
    <AppLayout headerTitle="Worker Leave Tracking" showLocation={false}>
      <FeatureGate feature="worker_leave">
      <div className="p-4 space-y-4">
        {canManage && (
          <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
            <DrawerTrigger asChild>
              <Button size="sm" className="gap-1"><Plus size={14} /> Record Leave</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader><DrawerTitle>Record Worker Leave</DrawerTitle></DrawerHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label>Worker</Label>
                  <Select value={workerId} onValueChange={setWorkerId}>
                    <SelectTrigger><SelectValue placeholder="Select worker" /></SelectTrigger>
                    <SelectContent>
                      {workers.map(w => <SelectItem key={w.id} value={w.id}>{getWorkerLabel(w)} ({w.worker_type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Date</Label><Input type="date" value={leaveDate} onChange={e => setLeaveDate(e.target.value)} /></div>
                  <div><Label>Type</Label>
                    <Select value={leaveType} onValueChange={setLeaveType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="absent">Absent</SelectItem>
                        <SelectItem value="sick">Sick Leave</SelectItem>
                        <SelectItem value="planned">Planned Leave</SelectItem>
                        <SelectItem value="half_day">Half Day</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Reason</Label><Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional reason" /></div>
                <Button onClick={handleAdd} disabled={submitting || !workerId} className="w-full">
                  {submitting ? <Loader2 size={16} className="mr-1 animate-spin" /> : null} Record Leave
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
        )}

        {leaves.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <CalendarOff className="mx-auto mb-3" size={40} />
            <p className="text-sm">No leave records yet</p>
          </div>
        ) : (
          leaves.map((l: any) => (
            <Card key={l.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                  <Calendar size={18} className="text-warning" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{l.worker?.profile?.name || l.worker?.worker_type || 'Unknown'}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{format(new Date(l.leave_date), 'dd MMM yyyy')}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{l.leave_type.replace('_', ' ')}</Badge>
                  </div>
                  {l.reason && <p className="text-xs text-muted-foreground mt-0.5">{l.reason}</p>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
