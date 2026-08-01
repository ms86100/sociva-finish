// @ts-nocheck
import { useMemo, useState } from 'react';
import { Eye, X, Clock } from 'lucide-react';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { ProductAttributeBlocks } from '@/components/product/ProductAttributeBlocks';
import { VegBadge } from '@/components/ui/veg-badge';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useCurrency } from '@/hooks/useCurrency';
import { deriveActionType, ACTION_CONFIG } from '@/lib/marketplace-constants';
import type { ProductFormData } from '@/hooks/useSellerProducts';
import type { SellerProfile } from '@/types/database';
import type { BlockData } from '@/hooks/useAttributeBlocks';

interface ProductFormPreviewProps {
  formData: ProductFormData;
  sellerProfile: SellerProfile | null;
  attributeBlocks?: BlockData[];
}

function buildMockProduct(formData: ProductFormData, sellerProfile: SellerProfile | null): ProductWithSeller {
  const price = parseFloat(formData.price) || 0;
  const mrp = formData.mrp ? parseFloat(formData.mrp) : null;
  const now = new Date().toISOString();

  return {
    id: 'preview',
    seller_id: sellerProfile?.id || 'preview-seller',
    name: formData.name.trim() || 'Product Name',
    price,
    mrp: mrp && mrp > price ? mrp : null,
    image_url: formData.image_url,
    category: formData.category || 'other',
    is_veg: formData.is_veg,
    is_available: formData.is_available,
    is_bestseller: formData.is_bestseller,
    is_recommended: formData.is_recommended,
    is_urgent: formData.is_urgent,
    description: formData.description || null,
    action_type: formData.action_type,
    contact_phone: formData.contact_phone || null,
    stock_quantity: formData.stock_quantity ? parseInt(formData.stock_quantity) : null,
    prep_time_minutes: formData.prep_time_minutes ? parseInt(formData.prep_time_minutes) : null,
    lead_time_hours: formData.lead_time_hours ? parseInt(formData.lead_time_hours) : null,
    accepts_preorders: formData.accepts_preorders,
    seller_name: sellerProfile?.business_name || 'Your Store',
    seller_verified: true,
    seller_is_available: true,
    created_at: now,
    updated_at: now,
  };
}

/** Preview of the product detail page (drawer) */
function ProductDetailPreview({
  open,
  onOpenChange,
  formData,
  sellerProfile,
  attributeBlocks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: ProductFormData;
  sellerProfile: SellerProfile | null;
  attributeBlocks?: BlockData[];
}) {
  const { formatPrice } = useCurrency();
  const price = parseFloat(formData.price) || 0;
  const mrp = formData.mrp ? parseFloat(formData.mrp) : null;
  const name = formData.name.trim() || 'Product Name';
  const specs = attributeBlocks && attributeBlocks.length > 0 ? { blocks: attributeBlocks } : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh] outline-none z-[80]">
        <div className="overflow-y-auto max-h-[calc(92vh-2rem)]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{name}</DrawerTitle>
          </DrawerHeader>

          <div className="relative w-full aspect-[4/3] max-h-[45vh] bg-muted">
            {formData.image_url ? (
              <img src={formData.image_url} alt={name} className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl">🛍️</div>
            )}
            <button
              onClick={() => onOpenChange(false)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center shadow-md border border-border/30"
              aria-label="Close"
            >
              <X size={18} className="text-foreground" />
            </button>
          </div>

          <div className="p-4 space-y-3">
            {formData.prep_time_minutes && parseInt(formData.prep_time_minutes) > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 bg-muted rounded-md px-2 py-1">
                  <Clock size={12} className="text-muted-foreground" />
                  <span className="text-[11px] font-bold text-muted-foreground uppercase">
                    {formData.prep_time_minutes} MINS
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2">
              {formData.is_veg !== undefined && <VegBadge isVeg={formData.is_veg} size="sm" className="mt-1" />}
              <h2 className="font-bold text-lg leading-tight text-foreground">{name}</h2>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-foreground">{formatPrice(price)}</span>
              {mrp && mrp > price && (
                <>
                  <span className="text-sm text-muted-foreground line-through">{formatPrice(mrp)}</span>
                  <span className="text-xs font-bold text-success bg-success/10 px-1.5 py-0.5 rounded">
                    {Math.round(((mrp - price) / mrp) * 100)}% OFF
                  </span>
                </>
              )}
            </div>

            {formData.description && (
              <div>
                <h4 className="text-xs font-bold text-foreground mb-1">Highlights</h4>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{formData.description}</p>
              </div>
            )}

            <ProductAttributeBlocks specifications={specs} />

            <div className="flex items-center gap-3 bg-muted rounded-xl p-3">
              <div className="w-10 h-10 rounded-xl bg-card flex items-center justify-center border border-border/30 text-muted-foreground text-lg">
                🏪
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">
                  {sellerProfile?.business_name || 'Your Store'}
                </p>
                <span className="text-[10px] text-accent font-medium">Preview Mode</span>
              </div>
            </div>
          </div>

          <div className="h-20" />
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-background border-t border-border p-4">
          {(() => {
            if (!formData.action_type) {
              console.warn('[Preview] Missing action_type in form data');
            }
            const effectiveAction = deriveActionType(formData.action_type, null);
            const ctaConfig = ACTION_CONFIG[effectiveAction];
            return (
              <Button className="w-full h-12 text-base font-bold bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl" disabled>
                {ctaConfig.label} · {formatPrice(price)}
              </Button>
            );
          })()}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Desktop sticky preview panel */
export function ProductFormPreviewPanel({ formData, sellerProfile, attributeBlocks }: ProductFormPreviewProps) {
  const { configs } = useCategoryConfigs();
  const [detailOpen, setDetailOpen] = useState(false);

  const mockProduct = useMemo(
    () => buildMockProduct(formData, sellerProfile),
    [formData, sellerProfile],
  );

  return (
    <div className="hidden lg:flex flex-col items-center sticky top-0">
      <div className="flex items-center gap-1.5 mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <Eye size={14} />
        <span>Live Preview</span>
      </div>

      <div className="w-[180px] rounded-2xl border-2 border-border bg-muted/30 p-2 shadow-sm">
        <div className="rounded-xl overflow-hidden">
          <ProductListingCard
            product={mockProduct}
            viewOnly
            categoryConfigs={configs}
            onViewClick={() => setDetailOpen(true)}
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mt-2 text-center max-w-[180px] leading-tight">
        Tap "View Details" to preview the full product page
      </p>

      <ProductDetailPreview
        open={detailOpen}
        onOpenChange={setDetailOpen}
        formData={formData}
        sellerProfile={sellerProfile}
        attributeBlocks={attributeBlocks}
      />
    </div>
  );
}

/** Mobile floating preview button + drawer */
export function ProductFormPreviewMobile({ formData, sellerProfile, attributeBlocks }: ProductFormPreviewProps) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const { configs } = useCategoryConfigs();

  const mockProduct = useMemo(
    () => buildMockProduct(formData, sellerProfile),
    [formData, sellerProfile],
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="lg:hidden fixed bottom-20 right-4 z-[60] rounded-full shadow-lg gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Eye size={14} />
        Preview
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="z-[70]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Eye size={16} />
              Live Preview
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col items-center pb-6 px-4 gap-3">
            <div className="w-[180px]">
              <ProductListingCard
                product={mockProduct}
                viewOnly
                categoryConfigs={configs}
                onViewClick={() => { setOpen(false); setTimeout(() => setDetailOpen(true), 300); }}
              />
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <ProductDetailPreview
        open={detailOpen}
        onOpenChange={setDetailOpen}
        formData={formData}
        sellerProfile={sellerProfile}
        attributeBlocks={attributeBlocks}
      />
    </>
  );
}
