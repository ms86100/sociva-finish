// @ts-nocheck
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useSystemSettings } from '@/hooks/useSystemSettings';

const CATEGORY_COLORS: Record<string, string> = {
  security: '#ef4444',
  water: '#3b82f6',
  electricity: '#f59e0b',
  repairs: '#8b5cf6',
  gardening: '#22c55e',
  lift_maintenance: '#06b6d4',
  staff_salaries: '#ec4899',
  miscellaneous: '#6b7280',
};

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

interface Props {
  expenses: { category: string; amount: number }[];
  onCategoryClick?: (category: string) => void;
}

export function SpendingPieChart({ expenses, onCategoryClick }: Props) {
  const { currencySymbol } = useSystemSettings();
  // Aggregate by category
  const categoryTotals = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
    return acc;
  }, {} as Record<string, number>);

  const data = Object.entries(categoryTotals).map(([category, amount]) => ({
    name: CATEGORY_LABELS[category] || category,
    value: amount,
    category,
  }));

  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">No expenses recorded yet</div>
    );
  }

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            onClick={(entry) => onCategoryClick?.(entry.category)}
            className="cursor-pointer"
          >
            {data.map((entry) => (
              <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category] || '#6b7280'} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number) => `${currencySymbol}${value.toLocaleString()}`} />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 gap-2">
        {data.map(d => (
          <button
            key={d.category}
            onClick={() => onCategoryClick?.(d.category)}
            className="flex items-center gap-2 text-left text-xs hover:bg-muted rounded-lg p-1.5 transition-colors"
          >
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[d.category] || '#6b7280' }} />
            <span className="flex-1 truncate">{d.name}</span>
            <span className="font-medium text-muted-foreground">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}
