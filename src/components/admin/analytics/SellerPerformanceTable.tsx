// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSellerPerformance, PeriodFilter } from '@/hooks/queries/useAdminAnalytics';
import { PeriodSelector } from './PeriodSelector';
import { useState } from 'react';
import { Star } from 'lucide-react';

export function SellerPerformanceTable() {
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const { data: sellers, isLoading } = useSellerPerformance(period);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold">Seller Performance</h3>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px] font-bold">Seller</TableHead>
                    <TableHead className="text-[11px] font-bold text-right">Total</TableHead>
                    <TableHead className="text-[11px] font-bold text-right text-emerald-600">Delivered</TableHead>
                    <TableHead className="text-[11px] font-bold text-right text-red-600">Cancelled</TableHead>
                    <TableHead className="text-[11px] font-bold text-right text-blue-600">Active</TableHead>
                    <TableHead className="text-[11px] font-bold text-right">Revenue</TableHead>
                    <TableHead className="text-[11px] font-bold text-right">Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sellers || []).map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="py-2.5">
                        <p className="text-xs font-bold truncate max-w-[140px]">{s.business_name}</p>
                        <p className="text-[10px] text-muted-foreground">{s.societyName}</p>
                      </TableCell>
                      <TableCell className="text-xs font-bold text-right tabular-nums">{s.total}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-emerald-600">{s.delivered}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-red-600">{s.cancelled}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-blue-600">{s.active}</TableCell>
                      <TableCell className="text-xs font-bold text-right tabular-nums">₹{s.totalRevenue.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-0.5 text-xs">
                          <Star size={10} className="fill-amber-400 text-amber-400" />
                          {s.rating?.toFixed(1) || '—'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!sellers?.length && (
                    <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">No sellers found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
