// @ts-nocheck
import { useSellerAnalytics } from '@/hooks/useSellerAnalytics';
import { useCurrency } from '@/hooks/useCurrency';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Users, ShoppingBag, Clock, Package, Ban, RotateCcw, Timer } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { fadeSlideUp, staggerContainer, cardEntrance } from '@/lib/motion-variants';

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
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || !Array.isArray(data.dailyRevenue)) return null;

  const stats = [
    {
      label: 'Settled revenue (30d)',
      value: formatPrice(data.settledRevenue30d),
      icon: TrendingUp,
      color: 'text-success',
    },
    {
      label: 'Settled orders (30d)',
      value: String(data.settledOrders30d),
      icon: ShoppingBag,
      color: 'text-primary',
    },
    {
      label: 'Repeat rate',
      value: `${data.repeatCustomerRate.toFixed(0)}%`,
      icon: Users,
      color: 'text-warning',
    },
    {
      label: 'Avg order (settled)',
      value: formatPrice(data.avgOrderValue),
      icon: TrendingUp,
      color: 'text-success',
    },
    {
      label: 'Cancel rate (30d)',
      value: `${data.cancelRate}%`,
      icon: Ban,
      color: 'text-muted-foreground',
    },
    {
      label: 'Refund rate (30d)',
      value: `${data.refundRate}%`,
      icon: RotateCcw,
      color: 'text-muted-foreground',
    },
  ];

  if (data.avgFulfillMinutes != null) {
    stats.push({
      label: 'Avg fulfill time',
      value: data.avgFulfillMinutes < 60
        ? `${data.avgFulfillMinutes}m`
        : `${(data.avgFulfillMinutes / 60).toFixed(1)}h`,
      icon: Timer,
      color: 'text-info',
    });
  }

  const bySales = data.topProducts.some((p) => p.qty > 0 || p.revenue > 0);

  return (
    <motion.div
      className="space-y-4"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <motion.div className="grid grid-cols-2 gap-3" variants={fadeSlideUp}>
        {stats.map((s) => (
          <motion.div
            key={s.label}
            variants={cardEntrance}
            className="bg-card border border-border rounded-xl p-3"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <s.icon size={14} className={s.color} />
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </div>
            <p className="text-lg font-bold tabular-nums">{s.value}</p>
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={fadeSlideUp} className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Settled revenue trend
        </p>
        <p className="text-[10px] text-muted-foreground mb-3">
          Completed / delivered only · excludes refunded payments
        </p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.dailyRevenue}>
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                }}
                formatter={(v: number) => [formatPrice(v), 'Settled']}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--success))"
                fill="url(#revenueGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {data.topProducts.length > 0 && (
        <motion.div variants={fadeSlideUp} className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {bySales ? 'Top products by sales' : 'Top products by views'}
          </p>
          <div className="space-y-2.5">
            {data.topProducts.map((p, i) => (
              <div key={p.product_id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                  <p className="text-sm font-medium truncate">{p.name}</p>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                  {bySales ? (
                    <>
                      <Package size={12} />
                      <span className="text-xs tabular-nums">{p.qty} sold</span>
                      <span className="text-xs font-medium text-foreground tabular-nums">
                        {formatPrice(p.revenue)}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs">{p.views} views</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {data.peakHours.length > 0 && (
        <motion.div variants={fadeSlideUp} className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Peak order hours
          </p>
          <div className="flex flex-wrap gap-2">
            {data.peakHours.slice(0, 6).map((h) => (
              <div
                key={h.hour}
                className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5"
              >
                <Clock size={12} className="text-muted-foreground" />
                <span className="text-xs font-medium">
                  {h.hour === 0
                    ? '12 AM'
                    : h.hour < 12
                      ? `${h.hour} AM`
                      : h.hour === 12
                        ? '12 PM'
                        : `${h.hour - 12} PM`}
                </span>
                <span className="text-[10px] text-muted-foreground">({h.count})</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
