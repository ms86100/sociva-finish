// @ts-nocheck
import { useState, useMemo } from 'react';
import { format, addDays, differenceInDays, isBefore, startOfToday } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CalendarDays, ArrowRight } from 'lucide-react';
import { RentalPeriodType } from '@/types/categories';
import { useMarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import { useCurrency } from '@/hooks/useCurrency';
import { DateRange } from 'react-day-picker';

interface DateRangePickerProps {
  startDate: Date | undefined;
  endDate: Date | undefined;
  onStartDateSelect: (date: Date | undefined) => void;
  onEndDateSelect: (date: Date | undefined) => void;
  pricePerPeriod: number;
  rentalPeriodType?: RentalPeriodType;
  depositAmount?: number;
  minDuration?: number;
  maxDuration?: number;
  unavailableDates?: Date[];
  className?: string;
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateSelect,
  onEndDateSelect,
  pricePerPeriod,
  rentalPeriodType = 'daily',
  depositAmount = 0,
  minDuration = 1,
  maxDuration = 30,
  unavailableDates = [],
  className,
}: DateRangePickerProps) {
  const today = startOfToday();
  const maxDate = addDays(today, 90); // Allow booking up to 90 days ahead
  const { formatPrice } = useCurrency();

  // Calculate total rental cost
  const rentalSummary = useMemo(() => {
    if (!startDate || !endDate) return null;

    let duration = 0;
    let totalCost = 0;

    switch (rentalPeriodType) {
      case 'hourly':
        // For hourly, assume end - start in hours
        duration = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)));
        break;
      case 'daily':
        duration = Math.max(1, differenceInDays(endDate, startDate) + 1);
        break;
      case 'weekly':
        duration = Math.max(1, Math.ceil(differenceInDays(endDate, startDate) / 7));
        break;
      case 'monthly':
        duration = Math.max(1, Math.ceil(differenceInDays(endDate, startDate) / 30));
        break;
    }

    totalCost = duration * pricePerPeriod;

    return {
      duration,
      totalCost,
      deposit: depositAmount,
      grandTotal: totalCost + depositAmount,
    };
  }, [startDate, endDate, pricePerPeriod, rentalPeriodType, depositAmount]);

  const isDateDisabled = (date: Date) => {
    if (isBefore(date, today)) return true;
    return unavailableDates.some(
      (d) => format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );
  };

  const handleSelect = (range: DateRange | undefined) => {
    onStartDateSelect(range?.from);
    onEndDateSelect(range?.to);
  };

  const selectedRange: DateRange | undefined = startDate 
    ? { from: startDate, to: endDate }
    : undefined;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Date Range Display */}
      <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
        <CalendarDays size={20} className="text-muted-foreground" />
        <div className="flex items-center gap-2 flex-1">
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">Start Date</p>
            <p className="font-medium">
              {startDate ? format(startDate, 'd MMM yyyy') : 'Select'}
            </p>
          </div>
          <ArrowRight size={16} className="text-muted-foreground" />
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">End Date</p>
            <p className="font-medium">
              {endDate ? format(endDate, 'd MMM yyyy') : 'Select'}
            </p>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="flex justify-center">
        <Calendar
          mode="range"
          selected={selectedRange}
          onSelect={handleSelect}
          disabled={isDateDisabled}
          numberOfMonths={1}
          className="rounded-md border pointer-events-auto"
        />
      </div>

      {/* Rental Summary */}
      {rentalSummary && (
        <div className="bg-card border rounded-lg p-4 space-y-2">
          <h4 className="font-semibold">Rental Summary</h4>
          
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {rentalSummary.duration} {rentalPeriodType === 'hourly' ? 'hour' : rentalPeriodType.replace('ly', '')}
              {rentalSummary.duration > 1 ? 's' : ''} × {formatPrice(pricePerPeriod)}
            </span>
            <span>{formatPrice(rentalSummary.totalCost)}</span>
          </div>

          {rentalSummary.deposit > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Refundable Deposit</span>
              <span>{formatPrice(rentalSummary.deposit)}</span>
            </div>
          )}

          <div className="border-t pt-2 mt-2">
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="text-primary">{formatPrice(rentalSummary.grandTotal)}</span>
            </div>
            {rentalSummary.deposit > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Deposit refunded upon return in good condition
              </p>
            )}
          </div>
        </div>
      )}

      {/* Duration Guidelines */}
      <div className="text-xs text-muted-foreground text-center">
        {minDuration > 1 && <span>Minimum: {minDuration} {rentalPeriodType.replace('ly', '')}s</span>}
        {minDuration > 1 && maxDuration && ' • '}
        {maxDuration && <span>Maximum: {maxDuration} {rentalPeriodType.replace('ly', '')}s</span>}
      </div>
    </div>
  );
}
