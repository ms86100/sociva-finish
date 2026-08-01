// @ts-nocheck
import { useSellerAnalytics } from '@/hooks/useSellerAnalytics';
import { useCurrency } from '@/hooks/useCurrency';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Users, ShoppingBag, Clock, Eye } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface SellerAnalyticsTabProps {
  sellerId: string;
}

export function SellerAnalyticsTab({ sellerId }: SellerAnalyticsTabProps) {
  const { data, isLoading } = useSellerAnalytics(sellerId);
  const { formatPrice } = useCurrency();

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data || !Array.isArray(data.dailyRevenue)) return null;

  const totalRevenue = (data.dailyRevenue || []).reduce((s, d) => s + (d.revenue || 0), 0);
  const totalOrders = (data.dailyRevenue || []).reduce((s, d) => s + (d.orders || 0), 0);

  const stats = [
    { label: 'Revenue (30d)', value: formatPrice(totalRevenue), icon: TrendingUp, color: 'text-accent' },
    { label: 'Orders (30d)', value: totalOrders.toString(), icon: ShoppingBag, color: 'text-primary' },
    { label: 'Repeat Rate', value: `${data.repeatCustomerRate.toFixed(0)}%`, icon: Users, color: 'text-warning' },
    { label: 'Avg Order', value: formatPrice(data.avgOrderValue), icon: TrendingUp, color: 'text-accent' },
  ];

  return (
    <div className="space-y-4">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <s.icon size={14} className={s.color} />
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </div>
            <p className="text-lg font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Revenue Trend</p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.dailyRevenue}>
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                formatter={(v: number) => [formatPrice(v), 'Revenue']}
              />
              <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#revenueGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Products */}
      {data.topProducts.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Top Products by Views</p>
          <div className="space-y-2.5">
            {data.topProducts.map((p, i) => (
              <div key={p.product_id} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                  <p className="text-sm font-medium truncate max-w-[200px]">{p.name}</p>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Eye size={12} />
                  <span className="text-xs">{p.views}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Peak Hours */}
      {data.peakHours.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Peak Order Hours</p>
          <div className="flex flex-wrap gap-2">
            {data.peakHours.slice(0, 6).map(h => (
              <div key={h.hour} className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5">
                <Clock size={12} className="text-muted-foreground" />
                <span className="text-xs font-medium">
                  {h.hour === 0 ? '12 AM' : h.hour < 12 ? `${h.hour} AM` : h.hour === 12 ? '12 PM' : `${h.hour - 12} PM`}
                </span>
                <span className="text-[10px] text-muted-foreground">({h.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
