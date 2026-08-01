// @ts-nocheck
import { useBuyerRecurringConfigs } from '@/hooks/useServiceBookings';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RefreshCw, XCircle, Loader2, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import { addDays, addWeeks, addMonths, format } from 'date-fns';

function computeNextDate(config: any): string | null {
  if (!config.is_active) return null;
  const lastDate = config.last_generated_date || config.start_date;
  if (!lastDate) return null;
  const base = new Date(lastDate + 'T00:00:00');
  let next: Date;
  switch (config.frequency) {
    case 'weekly': next = addWeeks(base, 1); break;
    case 'biweekly': next = addWeeks(base, 2); break;
    case 'monthly': next = addMonths(base, 1); break;
    default: next = addDays(base, 7);
  }
  if (config.end_date && next > new Date(config.end_date + 'T23:59:59')) return null;
  return format(next, 'MMM d, yyyy');
}

export function RecurringBookingsList() {
  const { user } = useAuth();
  const { data: configs = [], refetch } = useBuyerRecurringConfigs(user?.id);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const cancelRecurring = async (configId: string) => {
    setCancelling(configId);
    try {
      const { error } = await supabase
        .from('service_recurring_configs')
        .update({ is_active: false })
        .eq('id', configId)
        .eq('buyer_id', user?.id);
      if (error) throw error;
      refetch();
      toast.success('Recurring booking cancelled');
    } catch {
      toast.error('Failed to cancel');
    } finally {
      setCancelling(null);
    }
  };

  if (configs.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <RefreshCw size={14} className="text-primary" />
          Recurring Bookings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {configs.map((config: any) => {
          const nextDate = computeNextDate(config);
          return (
            <div key={config.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-card">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{config.product_name}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {config.frequency} · {config.preferred_time?.slice(0, 5)}
                </p>
                {nextDate && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <CalendarDays size={9} /> Next: {nextDate}
                  </p>
                )}
                {config.end_date && (
                  <p className="text-[10px] text-muted-foreground">
                    Ends: {format(new Date(config.end_date + 'T00:00:00'), 'MMM d, yyyy')}
                  </p>
                )}
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">Active</Badge>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10" disabled={cancelling === config.id}>
                    {cancelling === config.id ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Stop Recurring Booking?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will stop future auto-bookings for <strong>{config.product_name}</strong> ({config.frequency}). Existing bookings won't be affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Active</AlertDialogCancel>
                    <AlertDialogAction onClick={() => cancelRecurring(config.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Stop Recurring
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
