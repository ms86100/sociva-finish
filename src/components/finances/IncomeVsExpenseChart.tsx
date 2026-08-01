// @ts-nocheck
import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, parseISO } from 'date-fns';
import { useSystemSettings } from '@/hooks/useSystemSettings';

interface Props {
  expenses: { amount: number; expense_date: string }[];
  income: { amount: number; income_date: string }[];
}

export function IncomeVsExpenseChart({ expenses, income }: Props) {
  const { currencySymbol } = useSystemSettings();
  const data = useMemo(() => {
    const monthMap: Record<string, { month: string; income: number; expenses: number }> = {};

    income.forEach(i => {
      const key = format(parseISO(i.income_date), 'yyyy-MM');
      if (!monthMap[key]) monthMap[key] = { month: format(parseISO(i.income_date), 'MMM yy'), income: 0, expenses: 0 };
      monthMap[key].income += Number(i.amount);
    });

    expenses.forEach(e => {
      const key = format(parseISO(e.expense_date), 'yyyy-MM');
      if (!monthMap[key]) monthMap[key] = { month: format(parseISO(e.expense_date), 'MMM yy'), income: 0, expenses: 0 };
      monthMap[key].expenses += Number(e.amount);
    });

    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([, v]) => v);
  }, [expenses, income]);

  if (data.length === 0) {
    return <p className="text-center text-sm text-muted-foreground py-6">No data to compare</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${currencySymbol}${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(value: number) => `${currencySymbol}${value.toLocaleString()}`} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="income" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Income" />
        <Bar dataKey="expenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} name="Expenses" />
      </BarChart>
    </ResponsiveContainer>
  );
}
