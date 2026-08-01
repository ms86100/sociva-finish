// @ts-nocheck
import { MapPin, Pencil, Trash2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Address {
  id: string;
  label: string;
  flat_number: string;
  block: string;
  floor: string;
  building_name: string;
  landmark: string;
  full_address: string;
  pincode: string;
  is_default: boolean;
}

interface AddressCardProps {
  address: Address;
  onEdit: (address: Address) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}

export function AddressCard({ address, onEdit, onDelete, onSetDefault }: AddressCardProps) {
  const parts = [
    address.flat_number && `Flat ${address.flat_number}`,
    address.floor && `Floor ${address.floor}`,
    address.block && `Block ${address.block}`,
    address.building_name,
    address.landmark,
    address.pincode,
  ].filter(Boolean);

  return (
    <div className={`bg-card border rounded-xl p-3.5 ${address.is_default ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
          <MapPin size={16} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">{address.label}</span>
            {address.is_default && (
              <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Default</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {parts.join(', ') || address.full_address || 'No details added'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2.5 pl-12">
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => onEdit(address)}>
          <Pencil size={12} className="mr-1" /> Edit
        </Button>
        {!address.is_default && (
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => onSetDefault(address.id)}>
            <Star size={12} className="mr-1" /> Set Default
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive" onClick={() => onDelete(address.id)}>
          <Trash2 size={12} className="mr-1" /> Delete
        </Button>
      </div>
    </div>
  );
}
