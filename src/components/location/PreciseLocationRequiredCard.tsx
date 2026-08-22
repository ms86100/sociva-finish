import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LocationSelectorSheet } from '@/components/location/LocationSelectorSheet';
import { PRECISE_LOCATION_BODY, PRECISE_LOCATION_TITLE } from '@/lib/buyerLocation';

export function PreciseLocationRequiredCard({
  className = 'mx-4 mt-4',
}: {
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`rounded-xl border border-warning/30 bg-warning/10 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <MapPin size={18} className="text-warning shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{PRECISE_LOCATION_TITLE}</p>
            <p className="text-xs text-muted-foreground mt-1">{PRECISE_LOCATION_BODY}</p>
            <Button size="sm" className="mt-3 h-8 text-xs" onClick={() => setOpen(true)}>
              Update Location
            </Button>
          </div>
        </div>
      </div>
      <LocationSelectorSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
