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
import { useAuth } from '@/contexts/AuthContext';
import { useWorkerRole } from '@/hooks/useWorkerRole';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { toast } from 'sonner';
import { IndianRupee, Plus, Loader2, Wallet } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';

interface WorkerOption {
  id: string;
  worker_type: string;
  displayName: string;
}

export default function WorkerSalaryPage() {
  const { effectiveSocietyId, isSocietyAdmin, isAdmin, user, profile } = useAuth();
  const { workerProfile, isWorker } = useWorkerRole();
  const { formatPrice, currencySymbol } = useCurrency();
  const [salaries, setSalaries] = useState<any[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [workerId, setWorkerId] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [amount, setAmount] = useState('');

  const canManage = isSocietyAdmin || isAdmin;

  useEffect(() => {
    if (effectiveSocietyId) fetchData();
  }, [effectiveSocietyId]);

  const fetchData = async () => {
    setLoading(true);
    let salaryQuery = supabase.from('worker_salary_records')
      .select('*')
      .eq('society_id', effectiveSocietyId!)
      .order('month', { ascending: false })
      .limit(100);
    
    // Workers only see their own salary records
    if (isWorker && workerProfile) {
      salaryQuery = salaryQuery.eq('worker_id', workerProfile.id);
    }
    
    const [{ data: salaryData }, { data: workerData }] = await Promise.all([
      salaryQuery,
      supabase.from('society_workers')
        .select('id, worker_type, user_id')
        .eq('society_id', effectiveSocietyId!)
        .is('deactivated_at', null)
        .eq('status', 'active'),
    ]);

    const workerList = (workerData || []) as any[];
    const userIds = workerList.map((w: any) => w.user_id).filter(Boolean);
    let profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', userIds);
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p.name; });
    }

    const enrichedWorkers = workerList.map((w: any) => ({
      id: w.id,
      worker_type: w.worker_type,
      displayName: profileMap[w.user_id] || w.worker_type,
    }));

    // Enrich salaries with worker info
    const workerMap: Record<string, WorkerOption> = {};
    enrichedWorkers.forEach(w => { workerMap[w.id] = w; });
    const enrichedSalaries = ((salaryData || []) as any[]).map(s => ({
      ...s,
      workerInfo: workerMap[s.worker_id],
    }));

    setSalaries(enrichedSalaries);
    setWorkers(enrichedWorkers);
    setLoading(false);
  };

  const handleAdd = async () => {
    const writeSocietyId = profile?.society_id || effectiveSocietyId;
    if (!workerId || !amount || !writeSocietyId || !user) return;
    setSubmitting(true);
    const { error } = await supabase.from('worker_salary_records').insert({
      worker_id: workerId,
      society_id: writeSocietyId,
      month,
      amount: parseFloat(amount),
      status: 'pending',
      resident_id: user.id,
    });
    if (error) toast.error('Failed to record salary');
    else { toast.success('Salary recorded'); setSheetOpen(false); setAmount(''); fetchData(); }
    setSubmitting(false);
  };

  const markPaid = async (id: string) => {
    const { error } = await supabase.from('worker_salary_records')
      .update({ status: 'paid', paid_date: new Date().toISOString() })
      .eq('id', id);
    if (!error) { toast.success('Marked as paid'); fetchData(); }
  };

  if (loading) return (
    <AppLayout headerTitle="Worker Salary" showLocation={false}>
      <div className="p-4 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
    </AppLayout>
  );

  return (
    <AppLayout headerTitle="Worker Salary Tracking" showLocation={false}>
      <FeatureGate feature="worker_salary">
      <div className="p-4 space-y-4">
        {canManage && (
          <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
            <DrawerTrigger asChild>
              <Button size="sm" className="gap-1"><Plus size={14} /> Record Salary</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader><DrawerTitle>Record Worker Salary</DrawerTitle></DrawerHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label>Worker</Label>
                  <Select value={workerId} onValueChange={setWorkerId}>
                    <SelectTrigger><SelectValue placeholder="Select worker" /></SelectTrigger>
                    <SelectContent>
                      {workers.map(w => <SelectItem key={w.id} value={w.id}>{w.displayName} ({w.worker_type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Month</Label><Input type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>
                  <div><Label>Amount ({currencySymbol})</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5000" /></div>
                </div>
                <Button onClick={handleAdd} disabled={submitting || !workerId || !amount} className="w-full">
                  {submitting ? <Loader2 size={16} className="mr-1 animate-spin" /> : null} Record Salary
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
        )}

        {salaries.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Wallet className="mx-auto mb-3" size={40} />
            <p className="text-sm">No salary records yet</p>
          </div>
        ) : (
          salaries.map((s: any) => (
            <Card key={s.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <IndianRupee size={18} className="text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{s.workerInfo?.displayName || 'Unknown'}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{s.month}</span>
                    <span className="tabular-nums">{formatPrice(s.amount)}</span>
                  </div>
                </div>
                {s.status === 'paid' ? (
                  <Badge variant="default" className="text-[10px] bg-success/10 text-success">Paid</Badge>
                ) : canManage ? (
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => markPaid(s.id)}>Mark Paid</Button>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">Pending</Badge>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
