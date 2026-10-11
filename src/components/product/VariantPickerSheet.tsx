import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useCart } from '@/hooks/useCart';
import { useCurrency } from '@/hooks/useCurrency';
import { useProductVariants } from '@/hooks/useProductVariants';
import { closeVariantPicker } from '@/lib/variant-picker-store';
import { isVariantLive, type ProductVariant } from '@/lib/product-variants';
import { formatSelectedExtras, type SelectedExtra } from '@/lib/productExtras';
import { hapticImpact } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import type { Product } from '@/types/Database';

interface VariantPickerSheetProps {
  product: Product;
  extras?: SelectedExtra[];
}

function availabilityNote(v: ProductVariant): string | null {
  if (!isVariantLive(v)) return 'Not available';
  if (v.stock_quantity == null) return null;
  if (v.stock_quantity <= 0) return 'Out of stock';
  const threshold = v.low_stock_threshold ?? 5;
  if (v.stock_quantity <= threshold) return `Only ${v.stock_quantity} left`;
  return null;
}

export default function VariantPickerSheet({ product, extras = [] }: VariantPickerSheetProps) {
  const extrasSummary = formatSelectedExtras(extras).replace(/\n/g, ' · ');
  const { items, addItem, updateQuantity } = useCart();
  const { formatPrice } = useCurrency();
  const { variants, isLoading } = useProductVariants(product.id);
  const [busyId, setBusyId] = useState<string | null>(null);

  const lines = items.filter((item) => item.product_id === product.id && item.variant_id);
  const qtyFor = (variantId: string) => lines.find((l) => l.variant_id === variantId)?.quantity || 0;
  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
  const totalAmount = lines.reduce((sum, l) => sum + l.quantity * (l.product?.price || 0), 0);
  const showImages = variants.some((v) => v.image_url && v.image_url !== product.image_url);

  const run = async (variantId: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(variantId);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Drawer open onOpenChange={(open) => { if (!open) closeVariantPicker(); }}>
      <DrawerContent className="max-h-[85vh] outline-none">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-base">{product.name}</DrawerTitle>
          <DrawerDescription>Choose a size</DrawerDescription>
          {extrasSummary && <p className="text-xs text-muted-foreground line-clamp-2">With {extrasSummary}</p>}
        </DrawerHeader>

        <div className="px-4 pb-2 overflow-y-auto space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading sizes...</p>}
          {!isLoading && variants.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">No sizes are available right now.</p>
          )}
          {variants.map((v) => {
            const qty = qtyFor(v.id);
            const note = availabilityNote(v);
            const selectable = isVariantLive(v) && (v.stock_quantity == null || v.stock_quantity > 0);
            const canIncrement = v.stock_quantity == null || qty < v.stock_quantity;
            const busy = busyId === v.id;
            return (
              <div
                key={v.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-border p-3',
                  !selectable && qty === 0 && 'opacity-50',
                )}
              >
                {showImages && (
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {(v.image_url || product.image_url) && (
                      <img src={v.image_url || product.image_url || ''} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{v.label}</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-bold text-foreground tabular-nums">{formatPrice(v.price)}</span>
                    {v.compare_at_price != null && v.compare_at_price > v.price && (
                      <span className="text-xs text-muted-foreground line-through tabular-nums">{formatPrice(v.compare_at_price)}</span>
                    )}
                    {qty > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">= {formatPrice(v.price * qty)}</span>
                    )}
                  </div>
                  {note && <p className={cn('text-[11px] font-medium', selectable ? 'text-warning' : 'text-muted-foreground')}>{note}</p>}
                </div>

                {qty > 0 ? (
                  <div className="flex items-center rounded-lg bg-primary text-primary-foreground overflow-hidden">
                    <button
                      type="button"
                      aria-label={`Decrease ${v.label}`}
                      disabled={busy}
                      className="h-9 w-9 flex items-center justify-center disabled:opacity-50"
                      onClick={() => { hapticImpact('light'); void run(v.id, () => updateQuantity(product.id, qty - 1, v.id)); }}
                    >
                      <Minus size={14} strokeWidth={3} />
                    </button>
                    <span className="min-w-[24px] text-center text-sm font-bold tabular-nums">{qty}</span>
                    <button
                      type="button"
                      aria-label={canIncrement ? `Increase ${v.label}` : `Only ${v.stock_quantity} available`}
                      disabled={busy || !canIncrement || !selectable}
                      className="h-9 w-9 flex items-center justify-center disabled:opacity-40"
                      onClick={() => { hapticImpact('light'); void run(v.id, () => updateQuantity(product.id, qty + 1, v.id)); }}
                    >
                      <Plus size={14} strokeWidth={3} />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!selectable || busy}
                    className="h-9 min-w-[64px] border-primary text-primary font-bold"
                    onClick={() => { hapticImpact('medium'); void run(v.id, () => addItem(product, 1, true, extras, v)); }}
                  >
                    ADD
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <DrawerFooter>
          <Button type="button" className="h-11 font-bold" onClick={closeVariantPicker}>
            {totalQty > 0 ? `Done - ${totalQty} item${totalQty > 1 ? 's' : ''} - ${formatPrice(totalAmount)}` : 'Done'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
