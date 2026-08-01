// @ts-nocheck
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SetStoreLocationSheet } from '@/components/seller/SetStoreLocationSheet';
import { useState } from 'react';

interface MissingLocationBannerProps {
  sellerId: string;
  hasCoordinates: boolean;
  hasSocietyId: boolean;
}

export function MissingLocationBanner({ sellerId, hasCoordinates, hasSocietyId }: MissingLocationBannerProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  // Only show if store has no coordinates and no society fallback
  if (hasCoordinates || hasSocietyId) return null;

  return (
    <>
      <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 flex items-start gap-3">
        <MapPin size={20} className="text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-destructive">Your store is not visible to buyers</p>
          <p className="text-xs text-muted-foreground mt-0.5">Set your store location so customers can discover you in search results.</p>
          <Button
            size="sm"
            variant="destructive"
            className="mt-2 h-8 text-xs"
            onClick={() => setSheetOpen(true)}
          >
            <MapPin size={12} className="mr-1" />
            Set Location Now
          </Button>
        </div>
      </div>
      <SetStoreLocationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        sellerId={sellerId}
      />
    </>
  );
}
