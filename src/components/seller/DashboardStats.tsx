// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Package, Clock, Calendar, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashboardStatsProps {
  totalOrders: number;
  pendingOrders: number;
  todayOrders: number;
  completedOrders: number;
}

export function DashboardStats({ totalOrders, pendingOrders, todayOrders, completedOrders }: DashboardStatsProps) {
  const stats = [
    {
      icon: Package,
      value: totalOrders,
      label: 'Total Orders',
      borderColor: 'border-l-primary',
      color: 'text-primary',
    },
    {
      icon: Clock,
      value: pendingOrders,
      label: 'Pending',
      borderColor: 'border-l-warning',
      color: 'text-warning',
      pulse: pendingOrders > 0,
    },
    {
      icon: Calendar,
      value: todayOrders,
      label: 'Today',
      borderColor: 'border-l-info',
      color: 'text-info',
    },
    {
      icon: CheckCircle,
      value: completedOrders,
      label: 'Completed',
      borderColor: 'border-l-success',
      color: 'text-success',
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map(({ icon: Icon, value, label, color, borderColor, pulse }) => (
        <Card key={label} className={cn('border-l-2', borderColor, pulse && 'ring-1 ring-warning/40 animate-pulse')}>
          <CardContent className="p-2.5 text-center">
            <Icon className={`mx-auto mb-1 ${color}`} size={18} />
            <p className="text-lg font-bold tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
