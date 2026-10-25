import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Minus, Plus } from 'lucide-react';
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
import {
  canScheduleWhileClosed,
  formatClosedStoreAddPopupCopy,
  scheduleHoursFromProduct,
} from '@/lib/store-schedule';
import { computeStoreStatus } from '@/lib/store-availability';
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

function storeNeedsSchedule(product: Product): boolean {
  const hours = scheduleHoursFromProduct(product);
  const status = computeStoreStatus(
    hours.availabilityStart,
    hours.availabilityEnd,
    hours.operatingDays,
    hours.isAvailable !== false,
  );
  return status.status !== 'open' && canScheduleWhileClosed(status.status, hours.vacationMode);
}

export default function VariantPickerSheet({ product, extras = [] }: VariantPickerSheetProps) {
  const extrasSummary = formatSelectedExtras(extras).replace(/\n/g, ' · ');
  const navigate = useNavigate();
  const { items, addItem, updateQuantity } = useCart();
  const { formatPrice } = useCurrency();
  const { variants, isLoading } = useProductVariants(product.id);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Optimistic qty per size - survives until cart catches up or an add fails. */
  const [localQty, setLocalQty] = useState<Record<string, number>>({});
  const [scheduleHint, setScheduleHint] = useState<ReturnType<typeof formatClosedStoreAddPopupCopy> | null>(null);
  const inflightRef = useRef<Set<string>>(new Set());

  const needsSchedule = useMemo(() => storeNeedsSchedule(product), [product]);
  const lines = items.filter((item) => item.product_id === product.id && item.variant_id);

  // Pull cart truth in when nothing is mid-flight for that size.
  useEffect(() => {
    setLocalQty((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const line of lines) {
        if (!line.variant_id) continue;
        if (inflightRef.current.has(line.variant_id)) continue;
        if (next[line.variant_id] !== line.quantity) {
          next[line.variant_id] = line.quantity;
          changed = true;
        }
      }
      // Drop optimistic zeros that are not in cart (keeps ADD visible).
      for (const id of Object.keys(next)) {
        if (next[id] === 0 && !lines.some((l) => l.variant_id === id) && !inflightRef.current.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [lines]);

  const qtyFor = (variantId: string) => {
    const local = localQty[variantId];
    if (local != null && local > 0) return local;
    return lines.find((l) => l.variant_id === variantId)?.quantity || 0;
  };

  const totalQty = variants.reduce((sum, v) => sum + qtyFor(v.id), 0);
  const totalAmount = variants.reduce((sum, v) => sum + qtyFor(v.id) * v.price, 0);
  const showImages = variants.some((v) => v.image_url && v.image_url !== product.image_url);

  const setQtyOptimistic = (variantId: string, nextQty: number) => {
    setLocalQty((prev) => {
      const next = { ...prev };
      if (nextQty <= 0) delete next[variantId];
      else next[variantId] = nextQty;
      return next;
    });
  };

  const goScheduleInCart = () => {
    closeVariantPicker();
    navigate('/cart');
  };

  const addSize = async (v: ProductVariant) => {
    if (inflightRef.current.has(v.id)) return;
    hapticImpact('medium');
    const prev = qtyFor(v.id);
    setQtyOptimistic(v.id, prev + 1);
    inflightRef.current.add(v.id);
    setBusyId(v.id);
    try {
      const ok = await addItem(product, 1, true, extras, v);
      if (!ok) {
        setQtyOptimistic(v.id, prev);
        return;
      }
      if (needsSchedule) {
        setScheduleHint(formatClosedStoreAddPopupCopy(scheduleHoursFromProduct(product)));
      }
    } catch {
      setQtyOptimistic(v.id, prev);
    } finally {
      inflightRef.current.delete(v.id);
      setBusyId((cur) => (cur === v.id ? null : cur));
    }
  };

  const changeQty = async (v: ProductVariant, next: number) => {
    if (inflightRef.current.has(v.id)) return;
    hapticImpact('light');
    const prev = qtyFor(v.id);
    setQtyOptimistic(v.id, next);
    inflightRef.current.add(v.id);
    setBusyId(v.id);
    try {
      await updateQuantity(product.id, next, v.id);
    } catch {
      setQtyOptimistic(v.id, prev);
    } finally {
      inflightRef.current.delete(v.id);
      setBusyId((cur) => (cur === v.id ? null : cur));
    }
  };

  return (
    <Drawer open onOpenChange={(open) => { if (!open) closeVariantPicker(); }}>
      <DrawerContent className="max-h-[85vh] outline-none" data-testid="variant-picker-sheet">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-base">{product.name}</DrawerTitle>
          <DrawerDescription>
            {needsSchedule ? 'Choose a size - then schedule a time in cart' : 'Choose a size'}
          </DrawerDescription>
          {extrasSummary && <p className="text-xs text-muted-foreground line-clamp-2">With {extrasSummary}</p>}
        </DrawerHeader>

        {needsSchedule && (
          <div className="mx-4 mb-2 flex gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 text-left">
            <Clock size={16} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-[12px] leading-snug text-foreground">
              Store is closed. Add as many sizes as you want here. Checkout will ask you to pick a delivery time.
            </p>
          </div>
        )}

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
                  qty > 0 && 'border-primary/40 bg-primary/5',
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
                      onClick={() => void changeQty(v, qty - 1)}
                    >
                      <Minus size={14} strokeWidth={3} />
                    </button>
                    <span className="min-w-[24px] text-center text-sm font-bold tabular-nums" data-testid={`variant-qty-${v.id}`}>
                      {qty}
                    </span>
                    <button
                      type="button"
                      aria-label={canIncrement ? `Increase ${v.label}` : `Only ${v.stock_quantity} available`}
                      disabled={busy || !canIncrement || !selectable}
                      className="h-9 w-9 flex items-center justify-center disabled:opacity-40"
                      onClick={() => void changeQty(v, qty + 1)}
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
                    onClick={() => void addSize(v)}
                  >
                    ADD
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {scheduleHint && totalQty > 0 && (
          <div className="mx-4 mt-1 rounded-xl border border-primary/25 bg-primary/5 px-3 py-3 text-left" data-testid="variant-schedule-hint">
            <p className="text-sm font-semibold text-foreground">{scheduleHint.title}</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{scheduleHint.message}</p>
          </div>
        )}

        <DrawerFooter className="gap-2">
          {totalQty > 0 && needsSchedule ? (
            <>
              <Button type="button" className="h-11 font-bold" onClick={goScheduleInCart} data-testid="variant-schedule-in-cart">
                Schedule in cart - {totalQty} item{totalQty > 1 ? 's' : ''} - {formatPrice(totalAmount)}
              </Button>
              <Button type="button" variant="outline" className="h-10" onClick={closeVariantPicker}>
                Keep browsing this store
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className="h-11 font-bold"
              onClick={() => {
                if (totalQty > 0) {
                  closeVariantPicker();
                  navigate('/cart');
                  return;
                }
                closeVariantPicker();
              }}
            >
              {totalQty > 0
                ? `View cart - ${totalQty} item${totalQty > 1 ? 's' : ''} - ${formatPrice(totalAmount)}`
                : 'Done'}
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
