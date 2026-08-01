// @ts-nocheck
import { useBookingAddons } from '@/hooks/useServiceBookings';
import { useCurrency } from '@/hooks/useCurrency';
import { Sparkles } from 'lucide-react';

interface BookingAddonsSummaryProps {
  bookingId: string;
}

export function BookingAddonsSummary({ bookingId }: BookingAddonsSummaryProps) {
  const { data: addons = [] } = useBookingAddons(bookingId);
  const { formatPrice } = useCurrency();

  if (addons.length === 0) return null;

  const total = addons.reduce((sum, a) => sum + a.price, 0);

  return (
    <div className="space-y-1.5 pt-2 border-t border-border">
      <p className="text-xs font-medium flex items-center gap-1 text-muted-foreground">
        <Sparkles size={10} className="text-primary" />
        Add-ons
      </p>
      {addons.map((addon) => (
        <div key={addon.id} className="flex items-center justify-between text-xs">
          <span className="text-foreground">{addon.name}</span>
          <span className="font-medium tabular-nums">{formatPrice(addon.price)}</span>
        </div>
      ))}
      <div className="flex items-center justify-between text-xs font-semibold pt-1">
        <span>Add-ons subtotal</span>
        <span className="text-primary">{formatPrice(total)}</span>
      </div>
    </div>
  );
}
