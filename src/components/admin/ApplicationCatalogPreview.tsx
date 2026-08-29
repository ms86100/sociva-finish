import { Badge } from '@/components/ui/badge';
import { Package, Sparkles, Clock, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listingDiscountPercent, listingGlanceKind } from '@/lib/listing-glance';
import { ACTION_TYPE_LABEL, pendingApplicationCatalogCount } from '@/lib/admin-catalog-queue';
import type { ProductSummary } from '@/hooks/useSellerApplicationReview';

interface ApplicationCatalogPreviewProps {
  products: ProductSummary[];
  formatPrice: (n: number) => string;
  storePending: boolean;
}

export function ApplicationCatalogPreview({
  products,
  formatPrice,
  storePending,
}: ApplicationCatalogPreviewProps) {
  const openingCount = pendingApplicationCatalogCount(products);

  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-3 py-4 text-center">
        <p className="text-xs font-semibold text-foreground">No opening catalog yet</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          This application can still be reviewed. Listings added after approval will appear in the Products tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2 px-0.5">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
            <Sparkles size={11} className="text-primary" />
            Opening catalog ({products.length})
          </p>
          {storePending && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Reviewed with this store. Approving the application also approves{' '}
              {openingCount === 1 ? 'this listing' : `these ${openingCount} listings`}.
            </p>
          )}
        </div>
        {storePending && openingCount > 0 && (
          <Badge className="text-[9px] rounded-md h-5 bg-primary/10 text-primary border-0 shrink-0">
            With store
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {products.map((prod) => {
          const kind = listingGlanceKind(prod.action_type);
          const discount = listingDiscountPercent(Number(prod.price), prod.mrp, prod.discount_percentage);
          const actionLabel = prod.action_type ? ACTION_TYPE_LABEL[prod.action_type] || prod.action_type.replace(/_/g, ' ') : null;
          const duration = prod.service_duration_minutes || prod.prep_time_minutes;

          return (
            <div
              key={prod.id}
              className="rounded-2xl bg-gradient-to-br from-background via-muted/40 to-primary/[0.04] border border-border/40 p-2.5 flex gap-2.5"
            >
              {prod.image_url ? (
                <img src={prod.image_url} alt="" className="w-[72px] h-[72px] rounded-xl object-cover shrink-0 bg-muted" />
              ) : (
                <div className="w-[72px] h-[72px] rounded-xl bg-muted flex items-center justify-center shrink-0">
                  <Package size={18} className="text-muted-foreground/50" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold leading-snug line-clamp-2">{prod.name}</p>
                  {discount > 0 && (
                    <span className="text-[9px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md shrink-0">
                      {discount}% OFF
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  {prod.action_type === 'contact_seller' || Number(prod.price) <= 0 ? (
                    <span className="text-[11px] font-semibold text-muted-foreground">Contact for price</span>
                  ) : (
                    <>
                      <span className="text-[12px] font-extrabold text-primary">{formatPrice(Number(prod.price))}</span>
                      {prod.mrp && Number(prod.mrp) > Number(prod.price) && (
                        <span className="text-[10px] text-muted-foreground line-through">{formatPrice(Number(prod.mrp))}</span>
                      )}
                    </>
                  )}
                  {actionLabel && (
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded-md">
                      {actionLabel}
                    </span>
                  )}
                  {prod.is_veg && (
                    <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md">
                      Veg
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className="text-[10px] text-muted-foreground capitalize">{prod.category?.replace(/_/g, ' ')}</span>
                  {duration ? (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Clock size={9} /> {duration} min
                    </span>
                  ) : null}
                  {prod.delivery_time_text && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{prod.delivery_time_text}</span>
                  )}
                  {prod.contact_phone && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Phone size={8} /> {prod.contact_phone}
                    </span>
                  )}
                  <span
                    className={cn(
                      'text-[9px] font-semibold px-1.5 py-0.5 rounded-md border',
                      prod.approval_status === 'approved' && 'text-emerald-700 border-emerald-200 bg-emerald-50',
                      prod.approval_status === 'pending' && 'text-amber-700 border-amber-200 bg-amber-50',
                      prod.approval_status === 'draft' && 'text-muted-foreground border-border bg-muted',
                      prod.approval_status === 'rejected' && 'text-destructive border-destructive/30 bg-destructive/5',
                    )}
                  >
                    {prod.approval_status}
                  </span>
                </div>
                {prod.description && (
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{prod.description}</p>
                )}
                {kind !== 'product' && prod.tags && prod.tags.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">{prod.tags.slice(0, 3).join(' · ')}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
