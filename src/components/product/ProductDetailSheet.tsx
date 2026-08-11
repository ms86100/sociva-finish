// @ts-nocheck
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { fadeSlideUp, slideFromLeft, cardEntrance, staggerContainerSlow } from '@/lib/motion-variants';
import { supabase } from '@/integrations/supabase/client';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { VegBadge } from '@/components/ui/veg-badge';
import { Badge } from '@/components/ui/badge';
import { ContactSellerModal } from './ContactSellerModal';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { ProductEnquirySheet } from './ProductEnquirySheet';
import { ReportSheet } from '@/components/report/ReportSheet';
import { ServiceBookingFlow } from '@/components/booking/ServiceBookingFlow';
import { ProductAttributeBlocks } from './ProductAttributeBlocks';
import { PriceStabilityBadge } from '@/components/trust/PriceStabilityBadge';
import { RefundTierBadge } from '@/components/trust/RefundTierBadge';
import { Plus, Minus, Store, MapPin, Clock, Truck, Users, Zap, RotateCcw, ChevronRight, ChevronDown, Shield, Flag, X, Share2, Heart, Star } from 'lucide-react';
import { useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import { ProductFavoriteButton } from '@/components/favorite/ProductFavoriteButton';
import { useProductFavorites } from '@/hooks/useProductFavorites';
import { useProductDetail, ProductDetail } from '@/hooks/useProductDetail';
import { hapticImpact, hapticSelection } from '@/lib/haptics';
import { formatDistanceToNowStrict } from 'date-fns';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { computeStoreStatus, formatStoreClosedMessage, type StoreAvailability } from '@/lib/store-availability';
import { useAuth } from '@/contexts/AuthContext';
import { useCountUp } from '@/hooks/useCountUp';

const PriceHistoryChart = lazy(() =>
  import('./PriceHistoryChart').then((m) => ({ default: m.PriceHistoryChart })),
);

function formatSellerLastActive(lastActiveAt: string, ml: ReturnType<typeof useMarketplaceLabels>): string {
  try {
    const d = new Date(lastActiveAt);
    const diffMs = Date.now() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 1) return ml.label('label_active_now');
    if (diffHours < 24) return `${ml.label('label_active_now').split(' ')[0]} ${ml.label('label_active_hours_ago').replace('{hours}', String(Math.floor(diffHours)))}`;
    if (diffHours < 48) return `Active ${ml.label('label_active_yesterday').toLowerCase()}`;
    return `Active ${formatDistanceToNowStrict(d, { addSuffix: true })}`;
  } catch { return ''; }
}

interface ProductDetailSheetProps {
  product: ProductDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectProduct?: (product: any) => void;
  categoryIcon?: string;
  categoryName?: string;
}

export { type ProductDetail };

/** Only canonical slot-booking listings may enter the atomic booking flow. */
export function usesServiceBookingFlow(actionType: string | null | undefined): boolean {
  return actionType === 'book';
}

export function ProductDetailSheet({ product, open, onOpenChange, onSelectProduct, categoryIcon, categoryName }: ProductDetailSheetProps) {
  const { user } = useAuth();
  const d = useProductDetail(product, open, onOpenChange);
  const ml = useMarketplaceLabels();
  const [bookingOpen, setBookingOpen] = useState(false);
  const isServiceBookingAction = usesServiceBookingFlow(d.actionType);
  const { data: favoriteIds = [] } = useProductFavorites();

  // Animated price
  const animatedPrice = useCountUp(open && product ? Math.round(product.price) : 0, 600);

  // Track recently viewed + server-side view tracking
  useEffect(() => {
    if (open && product?.product_id) {
      try {
        const key = 'recently_viewed';
        const prev: string[] = JSON.parse(localStorage.getItem(key) || '[]');
        const next = [product.product_id, ...prev.filter(id => id !== product.product_id)].slice(0, 10);
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Recently viewed history is best-effort.
      }
      // Server-side view tracking
      if (user) {
        supabase.from('product_views' as any).insert({ product_id: product.product_id, viewer_id: user.id } as any).then(() => {});
      }
    }
  }, [open, product?.product_id, user]);

  const inlineAvailability = useMemo(() => {
    const p = product as any;
    const seller = p?.seller as any;
    const hasInlineAvailability = !!p && ('seller_availability_start' in p || 'seller_availability_end' in p || 'seller_operating_days' in p || 'seller_is_available' in p || (seller && ('availability_start' in seller || 'availability_end' in seller || 'operating_days' in seller || 'is_available' in seller)));
    return {
      hasInlineAvailability,
      availabilityStart: p?.seller_availability_start ?? seller?.availability_start ?? null,
      availabilityEnd: p?.seller_availability_end ?? seller?.availability_end ?? null,
      operatingDays: p?.seller_operating_days ?? seller?.operating_days ?? null,
      isAvailable: p?.seller_is_available ?? seller?.is_available ?? true,
    };
  }, [product]);

  const { data: fetchedSellerAvailability, isLoading: isLoadingSellerAvailability } = useQuery({
    queryKey: ['product-detail-seller-availability', product?.seller_id],
    queryFn: async () => {
      if (!product?.seller_id) return null;
      const { data } = await supabase.from('seller_profiles').select('availability_start, availability_end, operating_days, is_available, latitude, longitude').eq('id', product.seller_id).maybeSingle();
      return data;
    },
    enabled: open && !!product?.seller_id && !inlineAvailability.hasInlineAvailability,
    staleTime: 60 * 1000,
  });

  const effectiveAvailability = inlineAvailability.hasInlineAvailability ? inlineAvailability : {
    availabilityStart: fetchedSellerAvailability?.availability_start ?? null,
    availabilityEnd: fetchedSellerAvailability?.availability_end ?? null,
    operatingDays: fetchedSellerAvailability?.operating_days ?? null,
    isAvailable: fetchedSellerAvailability?.is_available ?? true,
  };

  const hasAvailabilityData = inlineAvailability.hasInlineAvailability || !!fetchedSellerAvailability;
  const isStoreCheckPending = !!product && !hasAvailabilityData && isLoadingSellerAvailability;
  const isStoreUnknown = !!product && !hasAvailabilityData && !isLoadingSellerAvailability;

  const storeAvailability: StoreAvailability = product
    ? computeStoreStatus(effectiveAvailability.availabilityStart, effectiveAvailability.availabilityEnd, effectiveAvailability.operatingDays, effectiveAvailability.isAvailable)
    : { status: 'open', nextOpenAt: null, minutesUntilOpen: 0 };

  const isStoreClosed = isStoreCheckPending || isStoreUnknown || storeAvailability.status !== 'open';
  const storeClosedMsg = isStoreCheckPending ? 'Checking store availability…' : isStoreUnknown ? 'Store unavailable right now' : isStoreClosed ? formatStoreClosedMessage(storeAvailability) : '';

  const distanceLabel = product?.distance_km != null
    ? (product.distance_km < 1 ? ml.label('label_distance_m_format').replace('{distance}', String(Math.round(product.distance_km * 1000))) : ml.label('label_distance_km_format').replace('{distance}', String(Math.round(product.distance_km * 10) / 10)))
    : null;
  const locationText = useMemo(() => {
    if (!product) return null;
    if (product.society_name) return distanceLabel ? `${product.society_name} · ${distanceLabel}` : product.society_name;
    if (distanceLabel) return `Nearby · ${distanceLabel}`;
    return null;
  }, [product?.society_name, distanceLabel]);

  if (!product) return null;


  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92vh] outline-none">
          <div className="overflow-y-auto max-h-[calc(92vh-2rem)]">
            <DrawerHeader className="sr-only"><DrawerTitle>{product.product_name}</DrawerTitle></DrawerHeader>
            {/* Image with scale entrance */}
            <motion.div
              className="relative w-full aspect-[4/3] max-h-[45vh] bg-muted overflow-hidden"
              initial={{ opacity: 0, scale: 1.03 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              {product.image_url ? (<img src={product.image_url} alt={product.product_name} className="w-full h-full object-contain" />) : (<div className="w-full h-full flex items-center justify-center"><DynamicIcon name={categoryIcon || '🛍️'} size={72} /></div>)}
              <button onClick={() => onOpenChange(false)} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center shadow-md border border-border/30" aria-label="Close"><X size={18} className="text-foreground" /></button>
              {product && user && (
                <div className="absolute top-3 right-14 z-10">
                  <ProductFavoriteButton
                    productId={product.product_id}
                    initialFavorite={favoriteIds.includes(product.product_id)}
                    size="md"
                    className="w-8 h-8 bg-background/80 backdrop-blur-sm shadow-md border border-border/30"
                  />
                </div>
              )}
            </motion.div>
            <motion.div
              className="p-4 space-y-3"
              variants={staggerContainerSlow}
              initial="hidden"
              animate="show"
            >
              <motion.div variants={fadeSlideUp} className="flex items-center gap-1.5 flex-wrap">
                {product.prep_time_minutes && (<div className="flex items-center gap-1 bg-muted rounded-md px-2 py-1"><Clock size={12} className="text-muted-foreground" /><span className="text-[11px] font-bold text-muted-foreground uppercase">{product.prep_time_minutes} MINS</span></div>)}
                {(product as any).accepts_preorders && (
                  <div className="flex items-center gap-1 bg-accent/10 border border-accent/20 rounded-md px-2 py-1">
                    <Clock size={12} className="text-accent" />
                    <span className="text-[11px] font-bold text-accent uppercase">
                      Pre-order{(product as any).lead_time_hours ? ` · ${(product as any).lead_time_hours}hr advance` : ''}
                    </span>
                  </div>
                )}
              </motion.div>
              <motion.div variants={fadeSlideUp} className="flex items-start gap-2">
                {product.is_veg !== null && <VegBadge isVeg={product.is_veg} size="sm" className="mt-1" />}
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-lg leading-tight text-foreground">{product.product_name}</h2>
                  {categoryName && <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">{categoryIcon && <DynamicIcon name={categoryIcon} size={14} />}{categoryName}</span>}
                </div>
              </motion.div>
              <motion.div variants={fadeSlideUp} className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-xs">
                {product.seller_rating > 0 && (
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    <Star size={13} className="fill-warning text-warning" aria-hidden="true" />
                    {Number(product.seller_rating).toFixed(1)}
                    {product.seller_reviews > 0 && <span className="font-normal text-muted-foreground">· {product.seller_reviews} reviews</span>}
                  </span>
                )}
                {!isStoreCheckPending && !isStoreUnknown && (
                  <span className={isStoreClosed ? 'font-medium text-destructive' : 'font-medium text-success'}>
                    {isStoreClosed ? storeClosedMsg : 'Available now'}
                  </span>
                )}
                {locationText && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <MapPin size={12} aria-hidden="true" />
                    {locationText}
                  </span>
                )}
              </motion.div>
              <motion.div variants={fadeSlideUp} className="flex items-baseline gap-2">
                {d.actionType === 'contact_seller' ? (<span className="text-sm font-medium text-muted-foreground">Contact for price</span>) : (<span className="text-xl font-bold text-foreground tabular-nums">{d.formatPrice(animatedPrice)}</span>)}
              </motion.div>
              <PriceStabilityBadge productId={product.product_id} />
              <RefundTierBadge amount={product.price} />
              {d.trustSnapshot && d.trustSnapshot.avg_response_min > 0 && (
                <motion.div variants={fadeSlideUp} className="flex items-center gap-1.5 bg-accent/10 border border-accent/20 rounded-lg px-2.5 py-1.5">
                  <Zap size={12} className="text-accent" />
                  <span className="text-[11px] font-semibold text-accent">Responds in ~{d.trustSnapshot.avg_response_min} min</span>
                </motion.div>
              )}
              <button onClick={() => d.setShowDetails(!d.showDetails)} className="flex items-center gap-1 text-xs font-medium text-primary">
                {d.showDetails ? 'Hide product details' : 'View product details'}
                <ChevronDown size={14} className={`transition-transform ${d.showDetails ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {d.showDetails && (
                  <motion.div
                    className="space-y-3"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {product.fulfillment_mode && (<div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2"><Truck size={14} className="text-accent shrink-0" /><span>{product.fulfillment_mode === 'self_pickup' && 'Self Pickup Only'}{product.fulfillment_mode === 'delivery' && 'Seller Delivers'}{product.fulfillment_mode === 'both' && 'Pickup or Delivery'}</span></div>)}
                    {product.delivery_note && <p className="text-xs text-muted-foreground italic">— {product.delivery_note}</p>}
                    {product.description && <div><h4 className="text-xs font-bold text-foreground mb-1">Highlights</h4><p className={`text-xs text-muted-foreground leading-relaxed ${!d.descExpanded ? 'line-clamp-3' : ''}`}>{product.description}</p>{product.description.length > 120 && <button onClick={() => d.setDescExpanded(!d.descExpanded)} className="text-[10px] font-medium text-primary mt-0.5">{d.descExpanded ? 'Show less' : 'Read more'}</button>}</div>}
                    <ProductAttributeBlocks specifications={d.loadedSpecs ?? product.specifications} />
                    <Suspense fallback={null}>
                      <PriceHistoryChart productId={product.product_id} priceStableSince={(product as any).price_stable_since} />
                    </Suspense>
                    {d.trustSnapshot && (d.trustSnapshot.completed_orders > 0 || d.trustSnapshot.avg_response_min > 0) && (
                      <div className="grid grid-cols-3 gap-2">
                        {d.trustSnapshot.completed_orders > 0 && <div className="bg-muted rounded-xl p-2.5 text-center"><Users size={14} className="mx-auto text-primary mb-1" /><p className="text-sm font-bold text-foreground">{d.trustSnapshot.completed_orders}</p><p className="text-[9px] text-muted-foreground">Orders</p></div>}
                        {d.trustSnapshot.avg_response_min > 0 && <div className="bg-muted rounded-xl p-2.5 text-center"><Zap size={14} className="mx-auto text-accent mb-1" /><p className="text-sm font-bold text-foreground">~{d.trustSnapshot.avg_response_min}m</p><p className="text-[9px] text-muted-foreground">Response</p></div>}
                        {d.trustSnapshot.repeat_customer_pct > 0 && <div className="bg-muted rounded-xl p-2.5 text-center"><RotateCcw size={14} className="mx-auto text-primary mb-1" /><p className="text-sm font-bold text-foreground">{d.trustSnapshot.repeat_customer_pct}%</p><p className="text-[9px] text-muted-foreground">Repeat</p></div>}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              {/* Seller card with slide-in */}
              <motion.div variants={slideFromLeft}>
                <Link to={`/seller/${product.seller_id}`} onClick={() => onOpenChange(false)} className="flex items-center gap-3 bg-muted rounded-xl p-3">
                  <div className="w-10 h-10 rounded-xl bg-card flex items-center justify-center border border-border/30"><Store size={18} className="text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{product.seller_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {d.isNewSeller ? <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">New Seller</Badge> : null}
                      {(product as any).seller_verified && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-0 font-bold">Verified</Badge>
                      )}
                      {product.is_same_society && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-success/10 text-success border-0 font-bold">Your society</Badge>
                      )}
                      {(product as any).delivery_time_text && (
                        <span className="flex items-center gap-0.5 text-[10px] text-primary font-semibold"><Clock size={9} />{(product as any).delivery_time_text}</span>
                      )}
                      {locationText ? (
                        (() => {
                          const lat = (product as any).seller_latitude ?? (product as any).seller?.latitude ?? fetchedSellerAvailability?.latitude;
                          const lng = (product as any).seller_longitude ?? (product as any).seller?.longitude ?? fetchedSellerAvailability?.longitude;
                          if (lat && lng) {
                            return (
                              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank'); }} className="flex items-center gap-0.5 text-[10px] text-primary font-medium"><MapPin size={10} />{locationText}</button>
                            );
                          }
                          return <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground"><MapPin size={10} />{locationText}</span>;
                        })()
                      ) : null}
                      {(product as any).last_active_at && (<span className="flex items-center gap-0.5 text-[10px] text-muted-foreground"><Clock size={9} />{formatSellerLastActive((product as any).last_active_at, ml)}</span>)}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                </Link>
              </motion.div>
            </motion.div>
            {/* Similar products with stagger */}
            {d.similarProducts.length > 0 && (
              <div className="px-4 pb-3">
                <h4 className="text-xs font-bold text-foreground mb-2 uppercase tracking-wide">Similar in {categoryName || 'this category'}</h4>
                <motion.div
                  className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1"
                  variants={staggerContainerSlow}
                  initial="hidden"
                  animate="show"
                >
                  {d.similarProducts.map((sp) => (
                    <motion.button
                      key={sp.id}
                      variants={cardEntrance}
                      className="shrink-0 w-28 text-left"
                      onClick={() => { onSelectProduct?.(sp); }}
                    >
                      <div className="w-28 h-28 rounded-xl bg-muted overflow-hidden mb-1.5">{sp.image_url ? <img src={sp.image_url} alt={sp.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl">🛍️</div>}</div>
                      <p className="text-[11px] font-medium line-clamp-1">{sp.name}</p>
                      {sp.seller?.business_name && <p className="text-[11px] text-muted-foreground">{sp.seller.business_name}</p>}
                      {sp.price > 0 && <p className="text-xs font-bold">{d.formatPrice(sp.price)}</p>}
                    </motion.button>
                  ))}
                </motion.div>
              </div>
            )}
            <div className="px-6 pb-3 flex items-center gap-4">
              <button
                onClick={async () => {
                  const shareUrl = `${window.location.origin}/#/product/${product.product_id}`;
                  const shareData = {
                    title: product.product_name,
                    text: `${product.product_name} by ${product.seller_name} — ${d.formatPrice(product.price)}`,
                    url: shareUrl,
                  };
                  try {
                    if (navigator.share) {
                      await navigator.share(shareData);
                    } else {
                      await navigator.clipboard.writeText(shareUrl);
                      const { showFeedback } = useFeedbackPopup();
                      showFeedback({
                        title: 'Link copied to clipboard',
                        variant: 'success'
                      });
                    }
                  } catch {
                    // Sharing may be cancelled or unavailable without affecting the sheet.
                  }
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Share2 size={12} />Share
              </button>
              <button onClick={() => { onOpenChange(false); d.setReportOpen(true); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"><Flag size={12} />Report</button>
            </div>
            <div className="h-20" />
          </div>
          {/* CTA with fade-up */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 bg-background border-t border-border p-4"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {isStoreClosed ? (
              <div className="w-full h-12 flex items-center justify-center bg-muted rounded-xl"><Clock size={16} className="text-muted-foreground mr-2" /><span className="text-sm font-medium text-muted-foreground">{storeClosedMsg}</span></div>
            ) : d.isStockEmpty ? (
              <div className="w-full h-12 flex items-center justify-center bg-muted rounded-xl"><span className="text-sm font-medium text-muted-foreground">Out of Stock</span></div>
            ) : d.isCartAction ? (
              d.quantity === 0 ? (
                <Button data-haptic="medium" className="w-full h-12 text-base font-bold bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl" onClick={() => { d.handleAdd(); }}>{d.actionType === 'buy_now' ? 'Buy Now' : 'Add to cart'} · {d.formatPrice(product.price)}</Button>
              ) : (
                <div className="flex items-center justify-between">
                  <div><span className="text-lg font-bold text-foreground">{d.formatPrice(product.price * d.quantity)}</span><span className="text-xs text-muted-foreground ml-1.5">{d.quantity} item{d.quantity > 1 ? 's' : ''}</span></div>
                  <div className="flex items-center bg-accent rounded-xl overflow-hidden">
                    <button data-haptic="light" className="px-3 py-2.5 text-accent-foreground" onClick={() => { d.updateQuantity(product.product_id, d.quantity - 1); }}><Minus size={16} strokeWidth={3} /></button>
                    <AnimatePresence mode="popLayout">
                      <motion.span
                        key={d.quantity}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="font-bold text-base text-accent-foreground min-w-[28px] text-center tabular-nums"
                      >
                        {d.quantity}
                      </motion.span>
                    </AnimatePresence>
                    <button data-haptic="light" className="px-3 py-2.5 text-accent-foreground" onClick={() => { d.updateQuantity(product.product_id, d.quantity + 1); }}><Plus size={16} strokeWidth={3} /></button>
                  </div>
                </div>
              )
            ) : (
              <Button data-haptic="medium" className="w-full h-12 text-base font-bold bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl" onClick={() => { if (isServiceBookingAction && product) { hapticSelection(); setBookingOpen(true); } else { hapticImpact('medium'); d.handleAdd(); } }}>
                <d.ActionIcon size={18} className="mr-2" />{d.config.label}
              </Button>
            )}
          </motion.div>
        </DrawerContent>
      </Drawer>
      {d.actionType === 'contact_seller' && <ContactSellerModal open={d.contactOpen} onOpenChange={d.setContactOpen} sellerName={product.seller_name} phone={product.contact_phone || ''} sellerId={product.seller_id} buyerId={user?.id ?? ''} productId={product.product_id} productName={product.product_name} />}
      {!d.isCartAction && d.actionType !== 'contact_seller' && !isServiceBookingAction && <ProductEnquirySheet open={d.enquiryOpen} onOpenChange={d.setEnquiryOpen} productId={product.product_id} productName={product.product_name} sellerId={product.seller_id} sellerName={product.seller_name} actionType={d.actionType} price={product.price} />}
      {isServiceBookingAction && product && (
        <ServiceBookingFlow open={bookingOpen} onOpenChange={setBookingOpen} productId={product.product_id} productName={product.product_name} sellerId={product.seller_id} sellerName={product.seller_name} price={product.price} category={product.category || ''} imageUrl={product.image_url} durationMinutes={product.prep_time_minutes || undefined} locationType={(product as any).location_type || undefined} subcategoryId={(product as any).subcategory_id || undefined} />
      )}
      <ReportSheet open={d.reportOpen} onOpenChange={d.setReportOpen} targetType="product" targetId={product.product_id} targetName={product.product_name} />
    </>
  );
}
