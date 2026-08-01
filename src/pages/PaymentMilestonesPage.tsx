// @ts-nocheck
import { useState, useEffect } from 'react';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import {
  IndianRupee, Calendar, CheckCircle, Clock, AlertTriangle, Building2, Plus, Trash2, Edit2, Loader2
} from 'lucide-react';

interface PaymentMilestone {
  id: string;
  title: string;
  description: string | null;
  milestone_stage: string;
  amount_percentage: number;
  due_date: string | null;
  status: string;
  created_at: string;
}

interface ResidentPayment {
  id: string;
  milestone_id: string;
  amount: number;
  payment_status: string;
  paid_at: string | null;
  transaction_reference: string | null;
}

const stageOrder = ['booking', 'foundation', 'slab', 'structure', 'finishing', 'possession'];

const stageLabels: Record<string, string> = {
  booking: 'Booking',
  foundation: 'Foundation',
  slab: 'Slab Casting',
  structure: 'Structure',
  finishing: 'Finishing',
  possession: 'Possession',
};

const statusConfig: Record<string, { color: string; icon: typeof CheckCircle }> = {
  upcoming: { color: 'bg-muted text-muted-foreground', icon: Clock },
  due: { color: 'bg-warning/10 text-warning', icon: AlertTriangle },
  overdue: { color: 'bg-destructive/10 text-destructive', icon: AlertTriangle },
  paid: { color: 'bg-success/10 text-success', icon: CheckCircle },
};

export default function PaymentMilestonesPage() {
  const { user, effectiveSocietyId, effectiveSociety, isSocietyAdmin, isAdmin, isBuilderMember } = useAuth();
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([]);
  const [payments, setPayments] = useState<ResidentPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Admin form
  const canManage = isSocietyAdmin || isAdmin || isBuilderMember;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMilestone | null>(null);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStage, setFormStage] = useState('booking');
  const [formPct, setFormPct] = useState('');
  const [formDue, setFormDue] = useState('');
  const [formStatus, setFormStatus] = useState('upcoming');

  useEffect(() => {
    if (!effectiveSocietyId) return;
    fetchData();
  }, [effectiveSocietyId]);

  const fetchData = async () => {
    setIsLoading(true);
    const [{ data: ms }, { data: ps }] = await Promise.all([
      supabase
        .from('payment_milestones')
        .select('*')
        .eq('society_id', effectiveSocietyId!)
        .order('due_date', { ascending: true }),
      user ? supabase
        .from('resident_payments')
        .select('*')
        .eq('resident_id', user.id)
        .eq('society_id', effectiveSocietyId!) : Promise.resolve({ data: [] }),
    ]);
    setMilestones((ms as PaymentMilestone[]) || []);
    setPayments((ps as ResidentPayment[]) || []);
    setIsLoading(false);
  };

  const openCreate = () => {
    setEditing(null);
    setFormTitle(''); setFormDesc(''); setFormStage('booking'); setFormPct(''); setFormDue(''); setFormStatus('upcoming');
    setSheetOpen(true);
  };

  const openEdit = (m: PaymentMilestone) => {
    setEditing(m);
    setFormTitle(m.title); setFormDesc(m.description || ''); setFormStage(m.milestone_stage);
    setFormPct(String(m.amount_percentage)); setFormDue(m.due_date?.split('T')[0] || ''); setFormStatus(m.status);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !effectiveSocietyId) return;
    setSaving(true);
    try {
      const payload: any = {
        society_id: effectiveSocietyId,
        title: formTitle.trim(),
        description: formDesc.trim() || null,
        milestone_stage: formStage,
        amount_percentage: Number(formPct) || 0,
        due_date: formDue || null,
        status: formStatus,
      };
      if (editing) {
        const { error } = await supabase.from('payment_milestones').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Milestone updated');
      } else {
        const { error } = await supabase.from('payment_milestones').insert(payload);
        if (error) throw error;
        toast.success('Milestone created');
      }
      setSheetOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this milestone?')) return;
    const { error } = await supabase.from('payment_milestones').delete().eq('id', id);
    if (error) toast.error(friendlyError(error));
    else { toast.success('Deleted'); fetchData(); }
  };

  // Group milestones by stage
  const groupedMilestones = stageOrder.reduce((acc, stage) => {
    const stageMilestones = milestones.filter(m => m.milestone_stage === stage);
    if (stageMilestones.length > 0) acc.push({ stage, milestones: stageMilestones });
    return acc;
  }, [] as { stage: string; milestones: PaymentMilestone[] }[]);

  const totalPercentage = milestones.reduce((sum, m) => sum + m.amount_percentage, 0);
  const paidPercentage = milestones
    .filter(m => {
      const payment = payments.find(p => p.milestone_id === m.id);
      return payment?.payment_status === 'paid' || m.status === 'paid';
    })
    .reduce((sum, m) => sum + m.amount_percentage, 0);

  const getPaymentForMilestone = (milestoneId: string) =>
    payments.find(p => p.milestone_id === milestoneId);

  if (isLoading) {
    return (
      <AppLayout headerTitle="Payment Schedule" showLocation={false}>
        <div className="p-4 space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Payment Schedule" showLocation={false}>
      <FeatureGate feature="payment_milestones">
      <div className="p-4 space-y-4">
        {/* Overview Card */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <IndianRupee className="text-primary" size={24} />
              </div>
              <div className="flex-1">
                <p className="font-semibold">{effectiveSociety?.name}</p>
                <p className="text-xs text-muted-foreground">Payment Milestone Tracker</p>
              </div>
              {canManage && (
                <Button size="sm" className="gap-1" onClick={openCreate}>
                  <Plus size={14} /> Add
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-semibold text-primary tabular-nums">{paidPercentage}% of {totalPercentage}%</span>
              </div>
              <Progress value={totalPercentage > 0 ? (paidPercentage / totalPercentage) * 100 : 0} className="h-3" />
            </div>
          </CardContent>
        </Card>

        {milestones.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Building2 className="mx-auto mb-3" size={40} />
            <p className="font-semibold">No Payment Milestones</p>
            <p className="text-sm mt-1">
              {canManage ? 'Tap "Add" to create payment milestones.' : "Your society admin hasn't set up payment milestones yet."}
            </p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />
            {groupedMilestones.map(({ stage, milestones: stageMilestones }) => (
              <div key={stage} className="relative mb-6">
                <div className="flex items-center gap-3 mb-3 relative z-10">
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                    {stageOrder.indexOf(stage) + 1}
                  </div>
                  <h3 className="font-semibold">{stageLabels[stage] || stage}</h3>
                </div>
                <div className="ml-14 space-y-3">
                  {stageMilestones.map(milestone => {
                    const payment = getPaymentForMilestone(milestone.id);
                    const effectiveStatus = payment?.payment_status === 'paid' ? 'paid' : milestone.status;
                    const config = statusConfig[effectiveStatus] || statusConfig.upcoming;
                    const StatusIcon = config.icon;

                    return (
                      <Card key={milestone.id} className="overflow-hidden">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-sm">{milestone.title}</p>
                                <Badge variant="outline" className={`text-[10px] ${config.color}`}>
                                  <StatusIcon size={10} className="mr-0.5" />
                                  {effectiveStatus}
                                </Badge>
                              </div>
                              {milestone.description && (
                                <p className="text-xs text-muted-foreground mt-1">{milestone.description}</p>
                              )}
                              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <IndianRupee size={10} /> {milestone.amount_percentage}% of total
                                </span>
                                {milestone.due_date && (
                                  <span className="flex items-center gap-1">
                                    <Calendar size={10} /> {new Date(milestone.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </span>
                                )}
                              </div>
                            </div>
                            {canManage && (
                              <div className="flex gap-1 ml-2">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(milestone)}>
                                  <Edit2 size={12} />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(milestone.id)}>
                                  <Trash2 size={12} />
                                </Button>
                              </div>
                            )}
                          </div>
                          {payment?.paid_at && (
                            <p className="text-[10px] text-success mt-2">
                              ✓ Paid on {new Date(payment.paid_at).toLocaleDateString('en-IN')}
                              {payment.transaction_reference && ` • Ref: ${payment.transaction_reference}`}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Sheet */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[70vh] overflow-y-auto">
          <DrawerHeader>
            <DrawerTitle>{editing ? 'Edit Milestone' : 'New Payment Milestone'}</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-4 mt-4">
            <div><Label>Title</Label><Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="e.g. Foundation Complete" /></div>
            <div><Label>Description</Label><Textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Details..." rows={2} /></div>
            <div><Label>Stage</Label>
              <Select value={formStage} onValueChange={setFormStage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stageOrder.map(s => <SelectItem key={s} value={s}>{stageLabels[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Amount (% of total)</Label><Input type="number" value={formPct} onChange={e => setFormPct(e.target.value)} placeholder="e.g. 10" min={0} max={100} /></div>
            <div><Label>Due Date</Label><Input type="date" value={formDue} onChange={e => setFormDue(e.target.value)} /></div>
            <div><Label>Status</Label>
              <Select value={formStatus} onValueChange={setFormStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="due">Due</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleSave} disabled={saving || !formTitle.trim()}>
              {saving && <Loader2 size={16} className="animate-spin mr-2" />}
              {editing ? 'Update Milestone' : 'Create Milestone'}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
      </FeatureGate>
    </AppLayout>
  );
}
