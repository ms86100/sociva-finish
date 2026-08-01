// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBuyerActivity, PeriodFilter } from '@/hooks/queries/useAdminAnalytics';
import { PeriodSelector } from './PeriodSelector';
import { useState } from 'react';
import { format } from 'date-fns';

export function BuyerActivityTable() {
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const { data: buyers, isLoading } = useBuyerActivity(period);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold">Buyer Activity</h3>
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
                    <TableHead className="text-[11px] font-bold">Buyer</TableHead>
                    <TableHead className="text-[11px] font-bold text-right">Total</TableHead>
                    <TableHead className="text-[11px] font-bold text-right text-emerald-600">Delivered</TableHead>
                    <TableHead className="text-[11px] font-bold text-right text-red-600">Cancelled</TableHead>
                    <TableHead className="text-[11px] font-bold text-right">Spent</TableHead>
                    <TableHead className="text-[11px] font-bold text-right">Last Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(buyers || []).map((b: any) => (
                    <TableRow key={b.id}>
                      <TableCell className="py-2.5">
                        <p className="text-xs font-bold truncate max-w-[120px]">{b.name}</p>
                        <p className="text-[10px] text-muted-foreground">{b.societyName} • {b.flat_number}</p>
                      </TableCell>
                      <TableCell className="text-xs font-bold text-right tabular-nums">{b.orderCount}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-emerald-600">{b.delivered}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-red-600">{b.cancelled}</TableCell>
                      <TableCell className="text-xs font-bold text-right tabular-nums">₹{b.totalSpent.toLocaleString()}</TableCell>
                      <TableCell className="text-[11px] text-right text-muted-foreground">
                        {b.lastOrderDate ? format(new Date(b.lastOrderDate), 'MMM d') : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!buyers?.length && (
                    <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">No buyer activity</TableCell></TableRow>
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
