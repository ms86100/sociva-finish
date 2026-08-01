// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminAnalytics, StatusBreakdownEntry } from '@/hooks/queries/useAdminAnalytics';
import { PeriodSelector } from './PeriodSelector';
import { ShoppingCart, TrendingUp, Store, Package, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

function MetricCard({ icon: Icon, value, label, color }: { icon: any; value: string; label: string; color: string }) {
  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', color)}>
          <Icon size={17} className="text-white" />
        </div>
        <div>
          <p className="text-xl font-extrabold tabular-nums">{value}</p>
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_COLORS: Record<string, string> = {
  delivered: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-emerald-100 text-emerald-700',
  placed: 'bg-blue-100 text-blue-700',
  accepted: 'bg-sky-100 text-sky-700',
  preparing: 'bg-amber-100 text-amber-700',
  ready: 'bg-violet-100 text-violet-700',
  cancelled: 'bg-red-100 text-red-700',
  requested: 'bg-indigo-100 text-indigo-700',
  confirmed: 'bg-teal-100 text-teal-700',
  scheduled: 'bg-cyan-100 text-cyan-700',
  enquired: 'bg-orange-100 text-orange-700',
};

export function PlatformOverview() {
  const { period, setPeriod, overview } = useAdminAnalytics();
  const d = overview.data;
  const fmt = (n: number) => n >= 1000 ? `₹${(n / 1000).toFixed(1)}K` : `₹${n}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Platform Overview</h3>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      {overview.isLoading ? (
        <div className="grid grid-cols-2 gap-3">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={ShoppingCart} value={String(d?.totalOrders || 0)} label="Total Orders" color="bg-amber-500" />
            <MetricCard icon={TrendingUp} value={fmt(d?.totalRevenue || 0)} label="Total Revenue" color="bg-blue-500" />
            <MetricCard icon={CheckCircle} value={fmt(d?.deliveredRevenue || 0)} label="Delivered ₹" color="bg-emerald-500" />
            <MetricCard icon={XCircle} value={fmt(d?.cancelledRevenue || 0)} label="Cancelled ₹" color="bg-red-500" />
            <MetricCard icon={Store} value={String(d?.activeSellers || 0)} label="Active Sellers" color="bg-violet-500" />
            <MetricCard icon={Package} value={String(d?.productsSold || 0)} label="Items Sold" color="bg-indigo-500" />
          </div>

          {/* Status Breakdown Table */}
          {d?.statusBreakdown && d.statusBreakdown.length > 0 && (
            <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden">
              <CardContent className="p-0">
                <div className="px-4 py-2.5 border-b border-border/30">
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status Breakdown</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px] font-bold">Status</TableHead>
                      <TableHead className="text-[11px] font-bold text-right">Count</TableHead>
                      <TableHead className="text-[11px] font-bold text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.statusBreakdown.map((row: StatusBreakdownEntry) => (
                      <TableRow key={row.status}>
                        <TableCell className="py-2">
                          <Badge className={cn('text-[10px] h-5 capitalize', STATUS_COLORS[row.status] || 'bg-muted text-muted-foreground')}>
                            {row.status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-bold text-right tabular-nums">{row.count}</TableCell>
                        <TableCell className="text-xs font-bold text-right tabular-nums">₹{row.revenue.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
