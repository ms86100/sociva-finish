// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Sparkles } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';

export interface SelectedAddon {
  id: string;
  name: string;
  price: number;
}

interface ServiceAddonPickerProps {
  productId: string;
  selectedAddons: SelectedAddon[];
  onAddonsChange: (addons: SelectedAddon[]) => void;
}

interface AddonRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
}

export function ServiceAddonPicker({ productId, selectedAddons, onAddonsChange }: ServiceAddonPickerProps) {
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { formatPrice } = useCurrency();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('service_addons')
        .select('id, name, description, price')
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('display_order');
      if (cancelled) return;
      if (error) console.error('Failed to load addons:', error);
      setAddons((data || []) as AddonRow[]);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [productId]);

  if (isLoading || addons.length === 0) return null;

  const toggleAddon = (addon: AddonRow) => {
    const isSelected = selectedAddons.some(a => a.id === addon.id);
    if (isSelected) {
      onAddonsChange(selectedAddons.filter(a => a.id !== addon.id));
    } else {
      onAddonsChange([...selectedAddons, { id: addon.id, name: addon.name, price: addon.price }]);
    }
  };

  const totalAddonPrice = selectedAddons.reduce((sum, a) => sum + a.price, 0);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium flex items-center gap-1.5">
        <Sparkles size={14} className="text-primary" />
        Optional Add-ons
      </p>
      <div className="space-y-1.5">
        {addons.map((addon) => {
          const isSelected = selectedAddons.some(a => a.id === addon.id);
          return (
            <label
              key={addon.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                isSelected ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/50'
              }`}
            >
              <Checkbox checked={isSelected} onCheckedChange={() => toggleAddon(addon)} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{addon.name}</span>
                {addon.description && <p className="text-[10px] text-muted-foreground">{addon.description}</p>}
              </div>
              <span className="text-sm font-semibold text-primary">+{formatPrice(addon.price)}</span>
            </label>
          );
        })}
      </div>
      {totalAddonPrice > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Add-ons total: <span className="font-semibold text-foreground">{formatPrice(totalAddonPrice)}</span>
        </p>
      )}
    </div>
  );
}
