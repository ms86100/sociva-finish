// @ts-nocheck
import { forwardRef, useState } from 'react';
import { MapPin, Check, Star } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { useDeliveryAddresses } from '@/hooks/useDeliveryAddresses';
import { toast } from 'sonner';

interface AddressPickerProps {
  selectedId?: string;
  onSelect: (address: any) => void;
  trigger?: React.ReactNode;
}

export const AddressPicker = forwardRef<HTMLDivElement, AddressPickerProps>(
  function AddressPicker({ selectedId, onSelect, trigger }, ref) {
    const { addresses, isLoading, setDefault } = useDeliveryAddresses();
    const [open, setOpen] = useState(false);

    const handleSetDefault = async (e: React.MouseEvent, addrId: string) => {
      e.stopPropagation();
      try {
        await setDefault(addrId);
      } catch {
        toast.error('Failed to set default address');
      }
    };

    return (
      <div ref={ref}>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            {trigger || (
              <button className="text-xs text-primary font-semibold">Change</button>
            )}
          </DrawerTrigger>
          <DrawerContent className="max-h-[70dvh]">
            <DrawerHeader>
              <DrawerTitle className="text-base">Select Delivery Address</DrawerTitle>
            </DrawerHeader>
            <div className="mt-4 space-y-2 overflow-y-auto pb-4 px-4">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
                </div>
              ) : addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No saved addresses. Add one from your profile.</p>
              ) : (
                addresses.map(addr => (
                  <button
                    key={addr.id}
                    onClick={() => { onSelect(addr); setOpen(false); }}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                      selectedId === addr.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <MapPin size={16} className="text-primary shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold">{addr.label}</p>
                        {addr.is_default && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Default</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {[addr.flat_number && `Flat ${addr.flat_number}`, addr.block && `Block ${addr.block}`, addr.building_name].filter(Boolean).join(', ')}
                      </p>
                      {!addr.is_default && addresses.length > 1 && (
                        <span
                          role="button"
                          onClick={(e) => handleSetDefault(e, addr.id)}
                          className="inline-flex items-center gap-1 mt-1 text-[11px] text-primary/70 hover:text-primary font-medium"
                        >
                          <Star size={10} /> Set as default
                        </span>
                      )}
                    </div>
                    {selectedId === addr.id && <Check size={16} className="text-primary shrink-0 mt-0.5" />}
                  </button>
                ))
              )}
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    );
  }
);
