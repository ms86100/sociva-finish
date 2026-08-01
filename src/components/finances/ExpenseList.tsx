// @ts-nocheck
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Flag, ExternalLink, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
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

interface Props {
  expenses: Expense[];
  onFlag?: (expenseId: string) => void;
  showFlag?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  security: 'Security',
  water: 'Water',
  electricity: 'Electricity',
  repairs: 'Repairs',
  gardening: 'Gardening',
  lift_maintenance: 'Lift Maintenance',
  staff_salaries: 'Staff Salaries',
  miscellaneous: 'Miscellaneous',
};

export function ExpenseList({ expenses, onFlag, showFlag = true }: Props) {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (expenses.length === 0 || !user) return;
    recordViews();
    fetchViewCounts();
  }, [expenses, user]);

  const recordViews = async () => {
    if (!user) return;
    // Record that user viewed these expenses (upsert, ignore conflicts)
    const inserts = expenses.map(e => ({ expense_id: e.id, user_id: user.id }));
    await supabase.from('expense_views').upsert(inserts as any, { onConflict: 'expense_id,user_id', ignoreDuplicates: true });
  };

  const fetchViewCounts = async () => {
    const ids = expenses.map(e => e.id);
    const { data } = await supabase
      .from('expense_views')
      .select('expense_id')
      .in('expense_id', ids);
    
    if (data) {
      const counts: Record<string, number> = {};
      data.forEach((v: any) => {
        counts[v.expense_id] = (counts[v.expense_id] || 0) + 1;
      });
      setViewCounts(counts);
    }
  };

  if (expenses.length === 0) {
    return <p className="text-center text-sm text-muted-foreground py-6">No expenses in this category</p>;
  }

  return (
    <div className="space-y-2">
      {expenses.map(exp => (
        <div key={exp.id} className="bg-card rounded-xl border border-border p-3 space-y-1">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium">{exp.title}</p>
              <p className="text-xs text-muted-foreground">
                {exp.vendor_name && `${exp.vendor_name} · `}
                {format(new Date(exp.expense_date), 'MMM d, yyyy')}
              </p>
            </div>
            <p className="text-sm font-bold">{formatPrice(Number(exp.amount))}</p>
          </div>
          <div className="flex items-center gap-2">
            {exp.invoice_url && (
              <a href={exp.invoice_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1">
                <ExternalLink size={10} /> Invoice
              </a>
            )}
            {viewCounts[exp.id] && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Eye size={10} /> {viewCounts[exp.id]} resident{viewCounts[exp.id] !== 1 ? 's' : ''} viewed
              </span>
            )}
            {showFlag && onFlag && (
              <Button variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground gap-1 ml-auto" onClick={() => onFlag(exp.id)}>
                <Flag size={10} /> Flag
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
