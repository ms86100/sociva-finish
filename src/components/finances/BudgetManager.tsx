// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Target, Loader2 } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';

interface Budget {
  id: string;
  category: string;
  budget_amount: number;
  fiscal_year: string;
}

interface Props {
  expenses: { category: string; amount: number }[];
}

const CATEGORIES = [
  'security', 'water', 'electricity', 'repairs', 'gardening',
  'lift_maintenance', 'staff_salaries', 'miscellaneous',
];

const LABELS: Record<string, string> = {
  security: 'Security', water: 'Water', electricity: 'Electricity',
  repairs: 'Repairs', gardening: 'Gardening', lift_maintenance: 'Lift Maintenance',
  staff_salaries: 'Staff Salaries', miscellaneous: 'Miscellaneous',
};

export function BudgetManager({ expenses }: Props) {
  const { effectiveSocietyId, isSocietyAdmin, isAdmin } = useAuth();
  const { formatPrice, currencySymbol } = useCurrency();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentYear = new Date().getFullYear().toString();
  const canManage = isSocietyAdmin || isAdmin;

  const fetchBudgets = useCallback(async () => {
    if (!effectiveSocietyId) return;
    const { data } = await supabase
      .from('society_budgets')
      .select('*')
      .eq('society_id', effectiveSocietyId)
      .eq('fiscal_year', currentYear);
    setBudgets((data as any) || []);
    setLoading(false);
  }, [effectiveSocietyId, currentYear]);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  const spentByCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
    return acc;
  }, {} as Record<string, number>);

  const handleAdd = async () => {
    if (!effectiveSocietyId || !newCategory || !newAmount) return;
    setSubmitting(true);
    const { error } = await supabase.from('society_budgets').upsert({
      society_id: effectiveSocietyId,
      category: newCategory,
      budget_amount: parseFloat(newAmount),
      fiscal_year: currentYear,
    } as any, { onConflict: 'society_id,category,fiscal_year' });
    if (error) toast.error('Failed to save budget');
    else { toast.success('Budget saved'); setAddOpen(false); setNewCategory(''); setNewAmount(''); fetchBudgets(); }
    setSubmitting(false);
  };

  if (loading) return <Skeleton className="h-40 w-full" />;

  const totalBudget = budgets.reduce((s, b) => s + Number(b.budget_amount), 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Budget vs Actual</p>
          <p className="text-xs text-muted-foreground">FY {currentYear}</p>
        </div>
        {canManage && (
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1"><Plus size={14} /> Set Budget</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader><SheetTitle>Set Category Budget</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-4">
                <div>
                  <Label>Category</Label>
                  <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c} value={c}>{LABELS[c] || c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Budget Amount ({currencySymbol})</Label>
                  <Input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="50000" />
                </div>
                <Button className="w-full" onClick={handleAdd} disabled={submitting || !newCategory || !newAmount}>
                  {submitting && <Loader2 size={14} className="animate-spin mr-1" />} Save Budget
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>

      {totalBudget > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex justify-between text-xs mb-1">
              <span>Total: {formatPrice(totalSpent)} / {formatPrice(totalBudget)}</span>
              <span className={totalSpent > totalBudget ? 'text-destructive font-bold' : 'text-success'}>
                {Math.round((totalSpent / totalBudget) * 100)}%
              </span>
            </div>
            <Progress value={Math.min((totalSpent / totalBudget) * 100, 100)} className="h-2" />
          </CardContent>
        </Card>
      )}

      {budgets.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <Target size={28} className="mx-auto mb-2" />
          <p className="text-sm">No budgets set for {currentYear}</p>
          {canManage && <p className="text-xs mt-1">Set category-wise budgets to track spending</p>}
        </div>
      ) : (
        budgets.map(b => {
          const spent = spentByCategory[b.category] || 0;
          const pct = b.budget_amount > 0 ? Math.round((spent / Number(b.budget_amount)) * 100) : 0;
          const overBudget = spent > Number(b.budget_amount);
          return (
            <Card key={b.id} className={overBudget ? 'border-destructive/30' : ''}>
              <CardContent className="p-3">
                <div className="flex justify-between items-center mb-1">
                  <p className="text-sm font-medium capitalize">{LABELS[b.category] || b.category}</p>
                  <p className={`text-xs font-bold ${overBudget ? 'text-destructive' : ''}`}>{pct}%</p>
                </div>
                <Progress value={Math.min(pct, 100)} className="h-1.5 mb-1" />
                <p className="text-[10px] text-muted-foreground">
                  {formatPrice(spent)} spent of {formatPrice(Number(b.budget_amount))}
                  {overBudget && <span className="text-destructive ml-1">• Over by {formatPrice(spent - Number(b.budget_amount))}</span>}
                </p>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
