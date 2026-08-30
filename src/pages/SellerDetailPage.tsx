// @ts-nocheck
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useRegisterScreenRefresh } from '@/hooks/usePullToRefresh';
import { motion } from 'framer-motion';
import { staggerContainer, cardEntrance, fadeSlideUp } from '@/lib/motion-variants';
import { computeStoreStatus, formatStoreClosedMessage } from '@/lib/store-availability';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProductCard } from '@/components/product/ProductCard';
import { ProductDetailSheet } from '@/components/product/ProductDetailSheet';
import { RatingStars } from '@/components/ui/rating-stars';
import { ReviewList } from '@/components/review/ReviewList';
import { FavoriteButton } from '@/components/favorite/FavoriteButton';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/contexts/AuthContext';
import { SellerProfile, Product, DAYS_OF_WEEK } from '@/types/Database';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { Clock, MapPin, Search, ShoppingCart, Calendar, Flag, X, ShieldCheck, AlertCircle, ChevronDown } from 'lucide-react';
import { shortStorePlaceLabel } from '@/lib/location-label-resolver';
import { BackButton } from '@/components/navigation/BackButton';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useCurrency } from '@/hooks/useCurrency';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useMarketplaceData } from '@/hooks/queries/useMarketplaceData';
import { notify } from '@/lib/notify';
import { showFeedback, useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import { PreciseLocationRequiredCard } from '@/components/location/PreciseLocationRequiredCard';
import { buyerCanOrderFromSeller } from '@/lib/sellerDiscoverability';
import { TasteRail } from '@/components/food/TasteRail';
import { availableTasteMoods, countFoodFacets, isFoodParentGroup } from '@/lib/food-facets';
import { emptyTasteBrowseState, productMatchesTasteBrowse } from '@/lib/food-taste';

export default function SellerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, effectiveSocietyId } = useAuth();
  const { configs: allCategoryConfigs } = useCategoryConfigs();
  const { items, totalAmount } = useCart();
  const { formatPrice } = useCurrency();
  const { browsingLocation: browsingLoc } = useBrowsingLocation();
  const { data: marketplaceSellers = [] } = useMarketplaceData();
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const sellerRef = useRef<SellerProfile | null>(null);
  sellerRef.current = seller;
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sellerNotFound, setSellerNotFound] = useState(false);
  const [sellerUnavailable, setSellerUnavailable] = useState(false);
  const [productsError, setProductsError] = useState(false);
  const [needsLocation, setNeedsLocation] = useState(false);
  const [showStoreDetails, setShowStoreDetails] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('menu');
  const tabsRef = useRef<HTMLDivElement>(null);
  const handleTabChange = (v: string) => {
    setActiveTab(v);
    if (v !== 'menu') {
      requestAnimationFrame(() =>
        tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      );
    }
  };
  const [menuSearch, setMenuSearch] = useState('');
  const [taste, setTaste] = useState(emptyTasteBrowseState);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportType, setReportType] = useState<string>('');
  const [reportDescription, setReportDescription] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const marketplaceSeller = useMemo(
    () => marketplaceSellers.find((entry: any) => entry.seller_id === id) || null,
    [marketplaceSellers, id]
  );

  // Use a stable flag to avoid re-triggering on every object reference change
  const marketplaceSellerReady = !!marketplaceSeller;

  useEffect(() => {
    if (id) {
      fetchSellerDetails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, marketplaceSellerReady, browsingLoc?.lat, browsingLoc?.lng]);

  const fetchSellerDetails = async () => {
    if (!id) return;

    const keepVisible = !!sellerRef.current;
    if (!keepVisible) {
      setIsLoading(true);
      setSellerNotFound(false);
      setSellerUnavailable(false);
      setProductsError(false);
      setNeedsLocation(false);
    }

    const canonicalSeller = marketplaceSeller
      ? ({
          id: marketplaceSeller.seller_id,
          user_id: marketplaceSeller.user_id,
          business_name: marketplaceSeller.business_name,
          description: marketplaceSeller.description || null,
          categories: marketplaceSeller.categories || [],
          cover_image_url: marketplaceSeller.cover_image_url || null,
          profile_image_url: marketplaceSeller.profile_image_url || null,
          is_available: marketplaceSeller.is_available,
          is_featured: marketplaceSeller.is_featured || false,
          rating: marketplaceSeller.rating || 0,
          total_reviews: marketplaceSeller.total_reviews || 0,
          society_id: null,
          availability_start: marketplaceSeller.availability_start || null,
          availability_end: marketplaceSeller.availability_end || null,
          operating_days: marketplaceSeller.operating_days || DAYS_OF_WEEK,
          latitude: marketplaceSeller.seller_latitude ?? null,
          longitude: marketplaceSeller.seller_longitude ?? null,
          avg_response_minutes: marketplaceSeller.avg_response_minutes ?? null,
          last_active_at: marketplaceSeller.last_active_at ?? null,
          completed_order_count: marketplaceSeller.completed_order_count ?? null,
          verification_status: 'approved',
          store_location_label: marketplaceSeller.store_location_label || null,
          society: marketplaceSeller.society_name
            ? {
                name: marketplaceSeller.society_name,
                latitude: marketplaceSeller.seller_latitude ?? null,
                longitude: marketplaceSeller.seller_longitude ?? null,
              }
            : null,
        } as any)
      : null;

    try {
      let sellerData: any = canonicalSeller;

      const sellerRes = await supabase
        .from('seller_profiles')
        .select(`
          id,
          user_id,
          business_name,
          description,
          categories,
          cover_image_url,
          profile_image_url,
          is_available,
          is_featured,
          rating,
          total_reviews,
          society_id,
          availability_start,
          availability_end,
          operating_days,
          latitude,
          longitude,
          fulfillment_mode,
          minimum_order_amount,
          delivery_note,
          cancellation_rate,
          vacation_mode,
          vacation_until,
          completed_order_count,
          avg_response_minutes,
          last_active_at,
          verification_status,
          store_location_label,
          society:societies!seller_profiles_society_id_fkey(name, address, city, state, pincode, latitude, longitude)
        `)
        .eq('id', id)
        .maybeSingle();

      if (sellerRes.error && !sellerData) {
        console.error('Seller fetch error:', sellerRes.error.message, sellerRes.error.code);
        if (!sellerRef.current) {
          setSellerNotFound(true);
          setIsLoading(false);
        }
        return;
      }

      if (sellerRes.data && sellerRes.data.verification_status === 'approved') {
        sellerData = {
          ...sellerData,
          ...sellerRes.data,
          categories: sellerRes.data.categories ?? sellerData?.categories ?? [],
          operating_days: sellerRes.data.operating_days ?? sellerData?.operating_days ?? DAYS_OF_WEEK,
          latitude: sellerRes.data.latitude ?? sellerData?.latitude ?? sellerRes.data.society?.latitude ?? null,
          longitude: sellerRes.data.longitude ?? sellerData?.longitude ?? sellerRes.data.society?.longitude ?? null,
          society: sellerRes.data.society ?? sellerData?.society ?? null,
        };
      }

      if (!sellerData) {
        console.warn('Seller not found or not approved:', id);
        setSellerNotFound(true);
        setIsLoading(false);
        return;
      }

      setSeller(sellerData);
      setIsLoading(false);

      const gate = await buyerCanOrderFromSeller(id, browsingLoc?.lat, browsingLoc?.lng);
      if (!gate.ok) {
        setProducts([]);
        if (gate.reason === 'buyer_location') {
          setNeedsLocation(true);
        } else {
          setSellerUnavailable(true);
          return;
        }
        return;
      }

      // ── Step 2: Fetch products (failure does NOT affect seller display) ──
      try {
        const productsRes = await supabase
          .from('products')
          .select('id, name, description, price, image_url, category, is_veg, is_bestseller, is_recommended, is_available, approval_status, seller_id, stock_quantity, discount_percentage, mrp, action_type, contact_phone, specifications, prep_time_minutes, tags, cuisine_type')
          .eq('seller_id', id)
          .eq('is_available', true)
          .eq('approval_status', 'approved')
          .order('is_bestseller', { ascending: false })
          .order('is_recommended', { ascending: false })
          .order('category');

        if (productsRes.error) {
          console.error('Products fetch error (seller still visible):', productsRes.error.message);
          setProductsError(true);
        } else {
          setProducts((productsRes.data || []) as Product[]);
        }
      } catch (prodErr) {
        console.error('Products fetch exception (seller still visible):', prodErr);
        setProductsError(true);
      }

      // ── Step 3: Distance calculation (non-blocking) ──
      const sellerLat = sellerData.latitude ?? sellerData.society?.latitude;
      const sellerLng = sellerData.longitude ?? sellerData.society?.longitude;

      if (sellerLat && sellerLng) {
        try {
          let buyerLat: number | null = null;
          let buyerLng: number | null = null;

          if (browsingLoc?.lat && browsingLoc?.lng) {
            buyerLat = browsingLoc.lat;
            buyerLng = browsingLoc.lng;
          }

          if (!buyerLat && !buyerLng && effectiveSocietyId) {
            const { data: buyerSociety } = await supabase
              .from('societies')
              .select('latitude, longitude')
              .eq('id', effectiveSocietyId)
              .single();
            buyerLat = buyerSociety?.latitude ?? null;
            buyerLng = buyerSociety?.longitude ?? null;
          }

          if (buyerLat && buyerLng) {
            const toRad = (deg: number) => (deg * Math.PI) / 180;
            const R = 6371;
            const dLat = toRad(sellerLat - buyerLat);
            const dLon = toRad(sellerLng - buyerLng);
            const a =
              Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(buyerLat)) *
                Math.cos(toRad(sellerLat)) *
                Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            setDistanceKm(Math.round(R * c * 10) / 10);
          }
        } catch (e) {
          console.error('Distance calc error:', e);
        }
      }
    } catch (error) {
      console.error('Error fetching seller:', error);
      if (!sellerRef.current) {
        setSellerNotFound(true);
        setIsLoading(false);
      }
    }
  };

  useRegisterScreenRefresh(() => fetchSellerDetails());

  const isFoodStore = products.some((p) => {
    const cfg = allCategoryConfigs.find((c) => c.category === p.category);
    return isFoodParentGroup(cfg?.parentGroup);
  });

  const filteredProducts = (() => {
    let result = activeCategory === 'all' ? products : products.filter((p) => p.category === activeCategory);
    if (menuSearch.trim()) {
      const q = menuSearch.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q));
    }
    if (isFoodStore && (countFoodFacets(taste) || taste.veg)) {
      result = result.filter((p) => productMatchesTasteBrowse(p, { ...taste, openNow: false }));
    }
    return result;
  })();

  const categories = ['all', ...new Set(products.map((p) => p.category))];

  const cartItemsFromSeller = items.filter(
    (item) => item.product?.seller_id === id
  );
  const cartTotal = cartItemsFromSeller.reduce(
    (sum, item) => sum + (item.product?.price || 0) * item.quantity,
    0
  );
  const cartCount = cartItemsFromSeller.reduce((sum, item) => sum + item.quantity, 0);

  const handleSubmitReport = async () => {
    if (!user || !reportType) {
      notify.block('Please select a report type');
      return;
    }

    setIsSubmittingReport(true);
    try {
      const { error } = await supabase.from('reports').insert({
        reporter_id: user.id,
        reported_seller_id: id,
        report_type: reportType,
        description: reportDescription || null,
      });

      if (error) throw error;

      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: 'Report submitted',
        description: 'Our moderation team will review within 24 hours. You\'ll be notified of any action taken. Your identity is kept confidential.',
        variant: 'success'
      });
      setIsReportOpen(false);
      setReportType('');
      setReportDescription('');
    } catch (error) {
      console.error('Error submitting report:', error);
      toast.error('Failed to submit report');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout showHeader={false} showNav={true} showCart={false}>
        <Skeleton className="h-48 w-full rounded-b-2xl" />
        <div className="p-4 space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (sellerUnavailable) {
    return (
      <AppLayout showHeader={false} showNav={true} showCart={false} safeTop={false}>
        <div className="p-4 text-center safe-top space-y-3">
          <p>This seller is not available for your location right now.</p>
          <Link to="/">
            <Button className="mt-4">Go Home</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  if (sellerNotFound || !seller) {
    return (
      <AppLayout showHeader={false} showNav={true} showCart={false} safeTop={false}>
        <div className="p-4 text-center safe-top">
          <p>Seller not found</p>
          <Link to="/">
            <Button className="mt-4">Go Home</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const operatingDays = seller.operating_days || DAYS_OF_WEEK;
  const place = shortStorePlaceLabel({
    societyName: (seller as any).society?.name,
    storeLocationLabel: (seller as any).store_location_label,
    societyAddress: (seller as any).society?.address,
  });
  const openDays = DAYS_OF_WEEK.filter((day) => operatingDays.includes(day));
  const openDaysLabel = openDays.length === 7 ? 'Every day' : openDays.length === 0 ? 'Hours vary' : openDays.join(' · ');
  const fulfillmentLabel = {
    self_pickup: 'Pickup',
    seller_delivery: 'Delivery',
    platform_delivery: 'Delivery',
    pickup_and_seller_delivery: 'Pickup & delivery',
    pickup_and_platform_delivery: 'Pickup & delivery',
  }[(seller as any).fulfillment_mode as string] || null;

  return (
    <AppLayout showHeader={false} showNav={true} showCart={true} safeTop={false}>
      {/* Cover Image */}
      <motion.div
        className="relative h-56"
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {seller.cover_image_url ? (
          <img
            src={seller.cover_image_url}
            alt={seller.business_name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 via-foreground/30 to-transparent" />
        
        <div
          className="absolute left-3 right-3 flex justify-between"
          style={{ top: 'max(1rem, var(--app-safe-top, 28px))' }}
        >
          <BackButton
            fallback="/"
            className="w-11 h-11 bg-foreground/50 backdrop-blur-sm border border-primary-foreground/20 text-primary-foreground"
            iconSize={20}
          />
          <div className="flex gap-2">
            {user && (
              <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
                <DialogTrigger asChild>
                   <button className="w-10 h-10 rounded-full bg-foreground/50 backdrop-blur-sm flex items-center justify-center shadow-md border border-primary-foreground/20">
                     <Flag size={18} className="text-primary-foreground" />
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Report Seller</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">What's the issue?</p>
                      <Select value={reportType} onValueChange={setReportType}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a reason" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="spam">Spam or misleading</SelectItem>
                          <SelectItem value="fraud">Suspected fraud</SelectItem>
                          <SelectItem value="harassment">Harassment</SelectItem>
                          <SelectItem value="inappropriate">Inappropriate content</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Additional details (optional)</p>
                      <Textarea
                        placeholder="Describe the issue..."
                        value={reportDescription}
                        onChange={(e) => setReportDescription(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setIsReportOpen(false)}>
                        Cancel
                      </Button>
                      <Button 
                        className="flex-1" 
                        disabled={!reportType || isSubmittingReport}
                        onClick={handleSubmitReport}
                      >
                        {isSubmittingReport ? 'Submitting...' : 'Submit Report'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
            <FavoriteButton sellerId={seller.id} size="md" />
          </div>
        </div>

      </motion.div>

      {/* #1 + #2: Store closed banner with reopen time */}
      {(() => {
        const storeStatus = computeStoreStatus(
          seller.availability_start,
          seller.availability_end,
          (seller as any).operating_days,
          seller.is_available !== false
        );
        if (storeStatus.status === 'open') return null;
        const closedMsg = formatStoreClosedMessage(storeStatus);
        return (
          <div className="mx-4 mt-3 flex items-start gap-3 bg-warning/10 border border-warning/30 rounded-xl p-3">
            <AlertCircle size={18} className="text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-warning-foreground">This store is currently closed</p>
              {closedMsg && <p className="text-xs text-muted-foreground mt-0.5">{closedMsg}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">Browse the menu and order when they reopen.</p>
            </div>
          </div>
        );
      })()}

      {/* Vacation mode banner */}
      {(seller as any).vacation_mode && (
        <div className="mx-4 mt-3 flex items-start gap-3 bg-muted border border-border rounded-xl p-3">
          <Calendar size={18} className="text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">On a break</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {(seller as any).vacation_until
                ? `Back on ${new Date((seller as any).vacation_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : 'Will be back soon'}
            </p>
          </div>
        </div>
      )}

      <motion.div
        className="px-4 -mt-8 relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 24 }}
      >
        <div className="bg-card rounded-xl shadow-elevated p-4 space-y-2.5">
          <div className="flex items-start gap-3">
            {seller.profile_image_url && (
              <div className="w-12 h-12 rounded-full border border-border overflow-hidden shrink-0">
                <img
                  src={seller.profile_image_url}
                  alt={seller.business_name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold leading-tight line-clamp-2">{seller.business_name}</h1>
              <div className="mt-1">
                <RatingStars
                  rating={seller.rating}
                  totalReviews={seller.total_reviews}
                  size="sm"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {seller.verification_status === 'approved' && (
                  <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-0 font-semibold">
                    <ShieldCheck size={10} className="mr-1" />
                    Approved store
                  </Badge>
                )}
                {seller.society_id === effectiveSocietyId && (
                  <Badge variant="secondary" className="text-[10px] bg-success/10 text-success border-0 font-semibold">
                    Your society
                  </Badge>
                )}
                {fulfillmentLabel && (
                  <Badge variant="outline" className="text-[10px] font-medium">
                    {fulfillmentLabel}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[13px] text-muted-foreground min-w-0">
            {(() => {
              const lat = (seller as any).latitude ?? (seller as any).society?.latitude;
              const lng = (seller as any).longitude ?? (seller as any).society?.longitude;
              if (!lat || !lng) {
                return (
                  <span className="truncate min-w-0 flex items-center gap-1">
                    <MapPin size={13} className="text-primary shrink-0" />
                    {place.short}
                  </span>
                );
              }
              const openMaps = async (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                try {
                  const { Capacitor } = await import('@capacitor/core');
                  if (Capacitor.isNativePlatform()) {
                    const { Browser } = await import('@capacitor/browser');
                    await Browser.open({ url: mapsUrl });
                    return;
                  }
                } catch {
                  // Fall back to opening the maps URL in a browser.
                }
                window.open(mapsUrl, '_blank', 'noopener');
              };
              return (
                <button
                  type="button"
                  onClick={openMaps}
                  className="truncate min-w-0 flex items-center gap-1 hover:text-primary transition-colors text-left"
                  title="Open in maps"
                >
                  <MapPin size={13} className="text-primary shrink-0" />
                  <span className="truncate">{place.short}</span>
                </button>
              );
            })()}
            {distanceKm !== null && (
              <span className="shrink-0 text-xs font-medium text-primary">
                {distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm} km`}
              </span>
            )}
            {seller.availability_start && seller.availability_end && (
              <span className="shrink-0 flex items-center gap-1 text-xs">
                <Clock size={12} />
                {seller.availability_start.slice(0, 5)}–{seller.availability_end.slice(0, 5)}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowStoreDetails((open) => !open)}
            className="flex items-center gap-1 text-xs font-medium text-primary"
          >
            <ChevronDown size={14} className={showStoreDetails ? 'rotate-180 transition-transform' : 'transition-transform'} />
            {showStoreDetails ? 'Hide store details' : 'Store details'}
          </button>

          {showStoreDetails && (
            <div className="space-y-2 pt-1 border-t border-border/60">
              {seller.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">{seller.description}</p>
              )}
              {place.full && (
                <p className="text-xs text-muted-foreground leading-snug">{place.full}</p>
              )}
              <p className="text-xs text-muted-foreground">Open {openDaysLabel}</p>
              {(seller as any).minimum_order_amount > 0 && (
                <p className="text-xs text-muted-foreground">Minimum order {formatPrice((seller as any).minimum_order_amount)}</p>
              )}
              {(seller as any).delivery_note && (
                <p className="text-xs text-muted-foreground">{(seller as any).delivery_note}</p>
              )}
              {(seller as any).completed_order_count > 0 && (
                <p className="text-xs text-muted-foreground">{(seller as any).completed_order_count} orders completed</p>
              )}
              {(seller as any).avg_response_minutes > 0 && (
                <p className="text-xs text-muted-foreground">Usually replies in about {(seller as any).avg_response_minutes} min</p>
              )}
              {seller.categories.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {seller.categories.map((cat) => {
                    const categoryInfo = allCategoryConfigs.find((c) => c.category === cat);
                    return categoryInfo?.displayName || cat.replace(/_/g, ' ');
                  }).join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Tabs */}
      <div ref={tabsRef} className="px-4 mt-4 scroll-mt-4">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full">
            <TabsTrigger value="menu" className="flex-1">Menu</TabsTrigger>
            <TabsTrigger value="reviews" className="flex-1">
              Reviews ({seller.total_reviews})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="menu" className="mt-4">
            {/* Search within menu */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search the menu"
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                className="pl-8 pr-8 h-9 bg-muted border-0 rounded-lg text-sm"
              />
              {menuSearch && (
                <button onClick={() => setMenuSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <X size={14} />
                </button>
              )}
            </div>
            {isFoodStore && (
              <div className="-mx-4 mb-3 border-y border-border/40">
                <TasteRail
                  value={taste}
                  onChange={setTaste}
                  showMoods
                  showUtilities
                  showOpenNow={false}
                  moods={availableTasteMoods(products)}
                  inventory={products}
                />
              </div>
            )}
            {categories.length > 2 && (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-4 -mx-4 px-4 sticky top-0 z-10 bg-background py-2 border-b border-border/50">
                {categories.map((cat) => {
                  const categoryInfo = allCategoryConfigs.find((c) => c.category === cat);
                  const catImage = categoryInfo?.imageUrl || (categoryInfo as any)?.image_url;
                  return (
                    <button
                      key={cat}
                      onClick={() => {
                        setActiveCategory(cat);
                        // Auto-scroll to section
                        const el = document.getElementById(`seller-cat-${cat}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                        activeCategory === cat
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {cat !== 'all' && catImage && (
                        <span className="w-3.5 h-3.5 rounded-full overflow-hidden shrink-0 inline-flex items-center justify-center border border-white/40">
                          <img src={catImage} alt="" className="w-full h-full object-cover" />
                        </span>
                      )}
                      {cat === 'all' ? 'All' : categoryInfo?.displayName || cat}
                    </button>
                  );
                })}
              </div>
            )}

            {filteredProducts.length > 0 ? (
              <motion.div
                className="space-y-0"
                key={activeCategory}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                {(() => {
                  // Group products by category for anchor-based scroll navigation
                  const uniqueCats = [...new Set(filteredProducts.map(p => p.category))];
                  const showSections = activeCategory === 'all' && uniqueCats.length > 1;
                  return showSections ? uniqueCats.map(cat => {
                    const catProducts = filteredProducts.filter(p => p.category === cat);
                    const categoryInfo = allCategoryConfigs.find(c => c.category === cat);
                    return (
                      <div key={cat} id={`seller-cat-${cat}`}>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide pt-4 pb-2 px-1">
                          {categoryInfo?.displayName || cat}
                        </p>
                        {catProducts.map(product => (
                          <div key={product.id} onClick={() => {
                            setSelectedProduct({
                              product_id: product.id, product_name: product.name, price: product.price,
                              image_url: product.image_url, is_veg: product.is_veg, category: product.category,
                              description: product.description, prep_time_minutes: product.prep_time_minutes,
                              fulfillment_mode: (seller as any).fulfillment_mode || null,
                              delivery_note: (seller as any).delivery_note || null,
                              action_type: product.action_type || 'add_to_cart',
                              contact_phone: product.contact_phone || null,
                              specifications: product.specifications, seller_id: seller!.id,
                              seller_name: seller!.business_name, seller_rating: seller!.rating,
                              seller_reviews: seller!.total_reviews,
                              seller_verified: seller!.verification_status === 'approved',
                              society_name: (seller as any).society?.name || null,
                              distance_km: distanceKm,
                              is_same_society: seller!.society_id === effectiveSocietyId,
                            });
                            setDetailOpen(true);
                          }} className="cursor-pointer">
                            <ProductCard product={product} />
                          </div>
                        ))}
                      </div>
                    );
                  }) : filteredProducts.map((product) => (
                    <div key={product.id} onClick={() => {
                      setSelectedProduct({
                        product_id: product.id, product_name: product.name, price: product.price,
                        image_url: product.image_url, is_veg: product.is_veg, category: product.category,
                        description: product.description, prep_time_minutes: product.prep_time_minutes,
                        fulfillment_mode: (seller as any).fulfillment_mode || null,
                        delivery_note: (seller as any).delivery_note || null,
                        action_type: product.action_type || 'add_to_cart',
                        contact_phone: product.contact_phone || null,
                        specifications: product.specifications, seller_id: seller!.id,
                        seller_name: seller!.business_name, seller_rating: seller!.rating,
                        seller_reviews: seller!.total_reviews,
                        seller_verified: seller!.verification_status === 'approved',
                        society_name: (seller as any).society?.name || null,
                        distance_km: distanceKm,
                        is_same_society: seller!.society_id === effectiveSocietyId,
                      });
                      setDetailOpen(true);
                    }} className="cursor-pointer">
                      <ProductCard product={product} />
                    </div>
                  ));
                })()}
              </motion.div>
            ) : needsLocation ? (
              <PreciseLocationRequiredCard className="mx-0 mt-4" />
            ) : productsError ? (
              <div className="text-center py-8 space-y-3">
                <AlertCircle size={24} className="mx-auto text-destructive" />
                <p className="text-muted-foreground">Couldn't load menu items</p>
                <Button variant="outline" size="sm" onClick={() => { setProductsError(false); fetchSellerDetails(); }}>
                  Retry
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 space-y-2">
                <p className="text-muted-foreground">No items listed yet</p>
                <p className="text-xs text-muted-foreground">Check back later or <Link to="/search" className="text-primary font-semibold hover:underline">browse other sellers</Link> in your community.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="reviews" className="mt-4">
            <ReviewList sellerId={seller.id} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Cart Footer removed — using global FloatingCartBar via showCart={true} */}

      <ProductDetailSheet
        product={selectedProduct}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSelectProduct={(sp) => {
          const catConfig = allCategoryConfigs.find(c => c.category === sp.category);
          setSelectedProduct({
            product_id: sp.id,
            product_name: sp.name,
            price: sp.price,
            image_url: sp.image_url,
            is_veg: sp.is_veg ?? true,
            category: sp.category,
            description: sp.description || null,
            seller_id: sp.seller_id,
            seller_name: sp.seller?.business_name || seller!.business_name,
            seller_rating: seller!.rating,
            seller_reviews: seller!.total_reviews,
            action_type: sp.action_type,
            _catIcon: catConfig?.icon || '🛍️',
            _catName: catConfig?.displayName || sp.category,
          });
        }}
        categoryIcon={selectedProduct ? allCategoryConfigs.find(c => c.category === selectedProduct.category)?.icon : undefined}
        categoryName={selectedProduct ? allCategoryConfigs.find(c => c.category === selectedProduct.category)?.displayName : undefined}
      />

    </AppLayout>
  );
}
