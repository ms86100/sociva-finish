// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger, DrawerDescription } from '@/components/ui/drawer';
import { Loader2, Plus, Trash2, IndianRupee } from 'lucide-react';
import { toast } from 'sonner';

const STAGES = [
  { value: 'booking', label: 'Booking' },
  { value: 'foundation', label: 'Foundation' },
  { value: 'slab', label: 'Slab Casting' },
  { value: 'structure', label: 'Structure' },
  { value: 'finishing', label: 'Finishing' },
  { value: 'possession', label: 'Possession' },
];

interface Milestone {
  id: string;
  title: string;
  description: string | null;
  milestone_stage: string;
  amount_percentage: number;
  due_date: string | null;
  status: string;
}

export function AdminPaymentMilestones() {
  const { effectiveSocietyId, user } = useAuth();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState('booking');
  const [percentage, setPercentage] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState('upcoming');

  const fetchMilestones = useCallback(async () => {
    if (!effectiveSocietyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('payment_milestones')
      .select('*')
      .eq('society_id', effectiveSocietyId)
      .order('due_date', { ascending: true });
    setMilestones((data as Milestone[]) || []);
    setLoading(false);
  }, [effectiveSocietyId]);

  useEffect(() => { fetchMilestones(); }, [fetchMilestones]);

  const resetForm = () => {
    setTitle(''); setDescription(''); setStage('booking');
    setPercentage(''); setDueDate(''); setStatus('upcoming');
  };

  const handleCreate = async () => {
    if (!effectiveSocietyId || !user || !title.trim() || !percentage) return;
    setSubmitting(true);

    const { error } = await supabase.from('payment_milestones').insert({
      society_id: effectiveSocietyId,
      title: title.trim(),
      description: description.trim() || null,
      milestone_stage: stage,
      amount_percentage: parseFloat(percentage),
      due_date: dueDate || null,
      status,
      created_by: user.id,
    });

    if (error) {
      toast.error('Failed to create milestone');
      console.error(error);
    } else {
      toast.success('Milestone created');
      setSheetOpen(false);
      resetForm();
      fetchMilestones();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('payment_milestones').delete().eq('id', id);
    if (!error) { toast.success('Milestone deleted'); fetchMilestones(); }
  };

  const totalPct = milestones.reduce((s, m) => s + m.amount_percentage, 0);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline">Total: {totalPct}%</Badge>
          <Badge variant={totalPct === 100 ? 'default' : 'destructive'} className="text-xs">
            {totalPct === 100 ? '✓ Complete' : `${100 - totalPct}% remaining`}
          </Badge>
        </div>
        <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
          <DrawerTrigger asChild>
            <Button size="sm"><Plus size={14} className="mr-1" /> Add</Button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[85vh] overflow-y-auto">
            <DrawerHeader>
              <DrawerTitle>Add Payment Milestone</DrawerTitle>
              <DrawerDescription>Define a construction-linked payment stage</DrawerDescription>
            </DrawerHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>Title *</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., 20% on Slab Completion" />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional details" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Stage</Label>
                  <Select value={stage} onValueChange={setStage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Percentage *</Label>
                  <Input type="number" value={percentage} onChange={e => setPercentage(e.target.value)} placeholder="e.g., 20" min="1" max="100" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upcoming">Upcoming</SelectItem>
                      <SelectItem value="due">Due</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleCreate} disabled={submitting || !title.trim() || !percentage} className="w-full">
                {submitting ? <Loader2 size={16} className="mr-1 animate-spin" /> : <Plus size={16} className="mr-1" />}
                Create Milestone
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      {milestones.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">No payment milestones configured</p>
      ) : (
        milestones.map(m => (
          <Card key={m.id}>
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm truncate">{m.title}</p>
                  <Badge variant="outline" className="text-[10px] capitalize">{m.status}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <span className="capitalize">{STAGES.find(s => s.value === m.milestone_stage)?.label}</span>
                  <span className="flex items-center gap-0.5"><IndianRupee size={10} /> {m.amount_percentage}%</span>
                  {m.due_date && <span>{new Date(m.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                </div>
              </div>
              <Button size="sm" variant="ghost" className="text-destructive h-8 w-8 p-0" onClick={() => handleDelete(m.id)}>
                <Trash2 size={14} />
              </Button>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
