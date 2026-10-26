import { useMemo, type MouseEvent } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCart } from '@/hooks/useCart';
import { useCurrency } from '@/hooks/useCurrency';
import { useHaptics } from '@/hooks/useHaptics';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { ACTION_CONFIG, deriveActionType, shouldShowMonetaryPrice } from '@/lib/marketplace-constants';
import { fulfillmentGlanceLabel } from '@/lib/listing-glance';
import { listingPrepMinutes } from '@/lib/guided-discovery';
import { openVariantPicker } from '@/lib/variant-picker-store';
import { useVariantProductIds } from '@/hooks/useProductVariants';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import type { CategoryConfig } from '@/types/categories';
import type { ProductActionType } from '@/types/Database';

function servesLabel(servingSize: string | null | undefined): string | null {
  const raw = (servingSize || '').trim();
  if (!raw) return null;
  if (/^serves\b/i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `Serves ${raw}`;
  return raw;
}

function prepLabel(product: ProductWithSeller): string | null {
  const mins = listingPrepMinutes(product) ?? Number(product.avg_preparation_time);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return `${Math.round(mins)} min prep`;
}

function ordersLabel(count: number | null | undefined): string | null {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? '1 order' : `${Math.round(n)} orders`;
}

/**
 * Equal-height Selling well card: fixed image ratio + reserved title/meta slots
 * so Biryani and Kebab always match in a 2-col row.
 */
export function SellingWellProductCard({
  product,
  onTap,
  categoryConfigs = [],
}: {
  product: ProductWithSeller;
  onTap: (product: ProductWithSeller) => void;
  categoryConfigs?: CategoryConfig[];
}) {
  const { addItem } = useCart();
  const { formatPrice } = useCurrency();
  const { impact } = useHaptics();
  const sizedProductIds = useVariantProductIds();

  const catCfg = categoryConfigs.find((config) => config.category === product.category);
  const actionType: ProductActionType = deriveActionType(
    product.action_type as string,
    catCfg?.transactionType,
    catCfg ? { supportsCart: catCfg.behavior?.supportsCart, enquiryOnly: catCfg.behavior?.enquiryOnly } : null,
  );
  const action = ACTION_CONFIG[actionType];
  const isCart = action.isCart;
  const hasSizes = isCart && sizedProductIds.has(product.id);
  const showMoney = shouldShowMonetaryPrice(actionType, product.price);
  const hasDiscount = !!(product.mrp && product.mrp > product.price);

  const line1 = useMemo(() => {
    const parts = [servesLabel(product.serving_size), prepLabel(product)].filter(Boolean);
    return parts.length > 0 ? parts.join(' - ') : '\u00A0';
  }, [product.serving_size, product.prep_time_minutes, product.avg_preparation_time, product.lead_time_hours]);

  const fulfill = fulfillmentGlanceLabel(product.fulfillment_mode) || (isCart ? 'Pickup + drop' : '\u00A0');
  const orders = ordersLabel(product.completed_order_count) || '\u00A0';

  const runAdd = async (event: MouseEvent) => {
    event.stopPropagation();
    if (!isCart) {
      onTap(product);
      return;
    }
    impact('medium');
    if (hasSizes) {
      openVariantPicker(product as any);
      return;
    }
    await addItem(product as any);
  };

  return (
    <button
      type="button"
      data-testid={`selling-well-card-${product.id}`}
      onClick={() => onTap(product)}
      className="flex h-full w-full flex-col overflow-hidden rounded-[18px] border border-border/70 bg-card text-left active:scale-[0.99] transition-transform"
    >
      <div className="relative aspect-[5/4] w-full shrink-0 overflow-hidden bg-muted">
        {product.image_url ? (
          <img
            src={optimizedImageUrl(product.image_url, { width: 420, quality: 78 })}
            alt=""
            className="h-full w-full object-cover"
            onError={handleImageError}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-muted to-secondary" />
        )}
        {isCart && (
          <span
            role="button"
            tabIndex={0}
            onClick={runAdd}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void runAdd(event as unknown as MouseEvent);
              }
            }}
            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md active:scale-95"
          >
            <Plus size={16} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col px-2.5 pt-2.5 pb-2.5">
        <p className="min-h-[2.5rem] text-[14px] font-extrabold leading-snug text-foreground line-clamp-2">
          {product.name}
        </p>
        <p className="mt-1 flex min-h-[1.25rem] items-baseline gap-1.5">
          {showMoney ? (
            <>
              {hasDiscount && (
                <span className="text-[12px] font-semibold text-muted-foreground line-through tabular-nums">
                  {formatPrice(product.mrp!)}
                </span>
              )}
              <span className={cn(
                'text-[15px] font-extrabold tabular-nums',
                hasDiscount ? 'text-emerald-600' : 'text-foreground',
              )}>
                {formatPrice(product.price)}
              </span>
            </>
          ) : (
            <span className="text-[15px] font-extrabold text-transparent">-</span>
          )}
        </p>
        <div className="mt-1 min-h-[3.15rem] space-y-0.5">
          <p className="text-[11px] leading-snug text-muted-foreground line-clamp-1">{line1}</p>
          <p className="text-[11px] leading-snug text-muted-foreground line-clamp-1">{fulfill}</p>
          <p className="text-[11px] leading-snug text-muted-foreground line-clamp-1">{orders}</p>
        </div>
      </div>
    </button>
  );
}
