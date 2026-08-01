// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/utils';
import { SpendingPieChart } from '@/components/finances/SpendingPieChart';
import { ExpenseList } from '@/components/finances/ExpenseList';
import { AddExpenseSheet } from '@/components/finances/AddExpenseSheet';
import { IncomeVsExpenseChart } from '@/components/finances/IncomeVsExpenseChart';
import { BudgetManager } from '@/components/finances/BudgetManager';
import { ExpenseFlagManager } from '@/components/finances/ExpenseFlagManager';
import { Loader2, Plus, TrendingUp, TrendingDown, Wallet, Download, Flag, Target } from 'lucide-react';
import { exportFinances } from '@/lib/csv-export';
import { ModuleSearchBar } from '@/components/search/ModuleSearchBar';
import { useCurrency } from '@/hooks/useCurrency';

interface Expense {
  id: string;
  category: string;
  title: string;
  amount: number;
  vendor_name: string | null;
  invoice_url: string | null;
  expense_date: string;
  created_at: string;
}

interface Income {
  id: string;
  source: string;
  amount: number;
  description: string | null;
  income_date: string;
  created_at: string;
}

export default function SocietyFinancesPage() {
  const { user, profile, isAdmin, isSocietyAdmin, effectiveSocietyId } = useAuth();
  const { formatPrice } = useCurrency();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [income, setIncome] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [flagExpenseId, setFlagExpenseId] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [flagging, setFlagging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    const sid = effectiveSocietyId;
    if (!sid) return;
    setLoading(true);
    const [expRes, incRes] = await Promise.all([
      supabase.from('society_expenses').select('*').eq('society_id', sid).order('expense_date', { ascending: false }),
      supabase.from('society_income').select('*').eq('society_id', sid).order('income_date', { ascending: false }),
    ]);
    setExpenses((expRes.data as any) || []);
    setIncome((incRes.data as any) || []);
    setLoading(false);
  }, [effectiveSocietyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalIncome = income.reduce((s, i) => s + Number(i.amount), 0);
  const balance = totalIncome - totalExpenses;

  const filteredExpenses = selectedCategory
    ? expenses.filter(e => e.category === selectedCategory)
    : expenses;

  const handleFlag = async () => {
    if (!flagExpenseId || !flagReason.trim() || !user) return;
    setFlagging(true);
    try {
      const { error } = await supabase.from('expense_flags').insert({
        expense_id: flagExpenseId,
        flagged_by: user.id,
        reason: flagReason.trim(),
      } as any);
      if (error) throw error;
      toast({ title: 'Expense flagged', description: 'The committee will review your concern.' });
      setFlagExpenseId(null);
      setFlagReason('');
    } catch (err: any) {
      toast({ title: 'Failed', description: friendlyError(err), variant: 'destructive' });
    } finally {
      setFlagging(false);
    }
  };

  return (
    <AppLayout headerTitle="Society Finances" showLocation={false}>
      <FeatureGate feature="finances">
      <div className="p-4 space-y-4">
        <ModuleSearchBar context="finances" value={searchQuery} onChange={setSearchQuery} />
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-2">
              <Card>
                <CardContent className="p-3 text-center">
                  <TrendingUp size={16} className="mx-auto text-success mb-1" />
                  <p className="text-xs text-muted-foreground">Collected</p>
                  <p className="text-sm font-bold tabular-nums">{formatPrice(totalIncome)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <TrendingDown size={16} className="mx-auto text-destructive mb-1" />
                  <p className="text-xs text-muted-foreground">Spent</p>
                  <p className="text-sm font-bold tabular-nums">{formatPrice(totalExpenses)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <Wallet size={16} className="mx-auto text-primary mb-1" />
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className={`text-sm font-bold tabular-nums ${balance >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatPrice(balance)}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="breakdown">
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="breakdown" className="text-xs">Spending</TabsTrigger>
                <TabsTrigger value="comparison" className="text-xs">Monthly</TabsTrigger>
                <TabsTrigger value="budget" className="text-xs">Budget</TabsTrigger>
                {(isAdmin || isSocietyAdmin) && <TabsTrigger value="flags" className="text-xs">Flags</TabsTrigger>}
              </TabsList>

              <TabsContent value="breakdown" className="space-y-4 mt-4">
                <SpendingPieChart
                  expenses={expenses}
                  onCategoryClick={(cat) => setSelectedCategory(selectedCategory === cat ? null : cat)}
                />
                {selectedCategory && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold capitalize">{selectedCategory.replace('_', ' ')} Expenses</h4>
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedCategory(null)}>
                        Show All
                      </Button>
                    </div>
                    <ExpenseList expenses={filteredExpenses} onFlag={setFlagExpenseId} />
                  </div>
                )}
                {!selectedCategory && expenses.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Recent Expenses</h4>
                    <ExpenseList expenses={expenses.slice(0, 10)} onFlag={setFlagExpenseId} />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="comparison" className="mt-4">
                <IncomeVsExpenseChart expenses={expenses} income={income} />
              </TabsContent>

              <TabsContent value="budget" className="mt-4">
                <BudgetManager expenses={expenses} />
              </TabsContent>

              {(isAdmin || isSocietyAdmin) && (
                <TabsContent value="flags" className="mt-4">
                  <ExpenseFlagManager />
                </TabsContent>
              )}
            </Tabs>
          </>
        )}
      </div>

      {/* Admin FABs */}
      {(isAdmin || isSocietyAdmin) && (
        <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-40 flex flex-col gap-2">
          {(expenses.length > 0 || income.length > 0) && (
            <Button size="sm" variant="outline" className="rounded-full shadow-lg gap-1" onClick={() => exportFinances(expenses, income)}>
              <Download size={14} /> Export
            </Button>
          )}
          <Button size="sm" className="rounded-full shadow-lg gap-1" onClick={() => setShowAddIncome(true)}>
            <Plus size={14} /> Income
          </Button>
          <Button size="sm" variant="destructive" className="rounded-full shadow-lg gap-1" onClick={() => setShowAddExpense(true)}>
            <Plus size={14} /> Expense
          </Button>
        </div>
      )}

      <AddExpenseSheet open={showAddExpense} onOpenChange={setShowAddExpense} onCreated={fetchData} type="expense" />
      <AddExpenseSheet open={showAddIncome} onOpenChange={setShowAddIncome} onCreated={fetchData} type="income" />

      {/* Flag Dialog */}
      <Dialog open={!!flagExpenseId} onOpenChange={(open) => { if (!open) setFlagExpenseId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Flag this Expense</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Explain why you'd like clarification on this expense. The committee will respond privately.</p>
          <Textarea value={flagReason} onChange={e => setFlagReason(e.target.value)} placeholder="What seems off?" rows={3} />
          <Button onClick={handleFlag} disabled={flagging || !flagReason.trim()}>
            {flagging && <Loader2 size={16} className="animate-spin mr-2" />}
            Submit Flag
          </Button>
        </DialogContent>
      </Dialog>
      </FeatureGate>
    </AppLayout>
  );
}
