// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCategoryAnalytics, PeriodFilter } from '@/hooks/queries/useAdminAnalytics';
import { PeriodSelector } from './PeriodSelector';
import { useState } from 'react';

export function CategoryAnalytics() {
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const { data, isLoading } = useCategoryAnalytics(period);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold">Category Analytics</h3>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <>
          <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b border-border/30">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Orders by Category</p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px] font-bold">Category</TableHead>
                      <TableHead className="text-[11px] font-bold text-right">Orders</TableHead>
                      <TableHead className="text-[11px] font-bold text-right">Qty</TableHead>
                      <TableHead className="text-[11px] font-bold text-right">Total ₹</TableHead>
                      <TableHead className="text-[11px] font-bold text-right text-emerald-600">Delivered ₹</TableHead>
                      <TableHead className="text-[11px] font-bold text-right text-red-600">Cancelled ₹</TableHead>
                      <TableHead className="text-[11px] font-bold text-right text-blue-600">Active ₹</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.categories || []).map((c: any) => (
                      <TableRow key={c.category}>
                        <TableCell className="text-xs font-semibold capitalize py-2.5">{c.category.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-xs font-bold text-right tabular-nums">{c.orders}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{c.quantity}</TableCell>
                        <TableCell className="text-xs font-bold text-right tabular-nums">₹{c.revenue.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums text-emerald-600">₹{c.deliveredRevenue.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums text-red-600">₹{c.cancelledRevenue.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums text-blue-600">₹{c.activeRevenue.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                    {!data?.categories?.length && (
                      <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">No category data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b border-border/30">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Top Products</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px] font-bold">Product</TableHead>
                    <TableHead className="text-[11px] font-bold text-right">Orders</TableHead>
                    <TableHead className="text-[11px] font-bold text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.topProducts || []).map((p: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-semibold truncate max-w-[160px] py-2.5">{p.name}</TableCell>
                      <TableCell className="text-xs font-bold text-right tabular-nums">{p.orders}</TableCell>
                      <TableCell className="text-xs font-bold text-right tabular-nums">₹{p.revenue.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {!data?.topProducts?.length && (
                    <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-8">No product data</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
