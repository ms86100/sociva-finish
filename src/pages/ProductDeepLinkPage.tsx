// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProductDetailSheet } from '@/components/product/ProductDetailSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { PreciseLocationRequiredCard } from '@/components/location/PreciseLocationRequiredCard';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { buyerCanOrderFromSeller } from '@/lib/sellerDiscoverability';

export default function ProductDeepLinkPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { browsingLocation } = useBrowsingLocation();
  const [product, setProduct] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLocation, setNeedsLocation] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!productId) return;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: fetchErr } = await supabase
          .from('products')
          .select(`
            id, name, price, image_url, is_veg, category, description,
            prep_time_minutes, delivery_time_text, action_type, contact_phone,
            specifications, seller_id, mrp, discount_percentage, stock_quantity,
            service_duration_minutes, service_scope, minimum_charge, visit_charge,
            lead_time_hours, accepts_preorders, price_stable_since,
            seller:seller_profiles!products_seller_id_fkey(
              id, business_name, rating, total_reviews, society_id,
              latitude, longitude, is_featured, is_available,
              availability_start, availability_end, operating_days,
              fulfillment_mode, delivery_note, avg_response_minutes, last_active_at,
              society:societies(name)
            )
          `)
          .eq('id', productId)
          .eq('is_available', true)
          .eq('approval_status', 'approved')
          .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!data) {
          setError('Product not found or no longer available');
          return;
        }

        const gate = await buyerCanOrderFromSeller(
          data.seller_id,
          browsingLocation?.lat,
          browsingLocation?.lng,
        );
        if (!gate.ok) {
          if (gate.reason === 'buyer_location') {
            setNeedsLocation(true);
            setError('Precise location required');
          } else {
            setError('This product is not available in your area.');
          }
          return;
        }

        const seller = data.seller as any;
        setProduct({
          product_id: data.id,
          product_name: data.name,
          price: data.price,
          image_url: data.image_url,
          is_veg: data.is_veg,
          category: data.category,
          description: data.description,
          prep_time_minutes: data.prep_time_minutes,
          delivery_time_text: data.delivery_time_text,
          action_type: data.action_type,
          contact_phone: data.contact_phone,
          specifications: data.specifications,
          mrp: data.mrp,
          discount_percentage: data.discount_percentage,
          stock_quantity: data.stock_quantity,
          service_duration_minutes: data.service_duration_minutes,
          service_scope: data.service_scope,
          minimum_charge: data.minimum_charge,
          visit_charge: data.visit_charge,
          lead_time_hours: data.lead_time_hours,
          accepts_preorders: data.accepts_preorders,
          price_stable_since: data.price_stable_since,
          fulfillment_mode: seller?.fulfillment_mode || null,
          delivery_note: seller?.delivery_note || null,
          seller_id: seller?.id || data.seller_id,
          seller_name: seller?.business_name || '',
          seller_rating: seller?.rating || 0,
          seller_reviews: seller?.total_reviews || 0,
          seller_verified: !!seller?.is_featured,
          seller_availability_start: seller?.availability_start || null,
          seller_availability_end: seller?.availability_end || null,
          seller_operating_days: seller?.operating_days || null,
          seller_is_available: seller?.is_available ?? true,
          seller_latitude: seller?.latitude ?? null,
          seller_longitude: seller?.longitude ?? null,
          avg_response_minutes: seller?.avg_response_minutes ?? null,
          last_active_at: seller?.last_active_at ?? null,
          society_name: seller?.society?.name || null,
          distance_km: null,
          is_same_society: false,
        });
        setSheetOpen(true);
      } catch (e) {
        console.error('[ProductDeepLink] Error:', e);
        setError('Failed to load product');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [productId, browsingLocation?.lat, browsingLocation?.lng]);

  const handleSheetClose = useCallback((open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      // Only navigate to seller page if we haven't already navigated elsewhere
      // (e.g., add-to-cart celebration popup navigates to /cart)
      const currentPath = location.pathname;
      if (currentPath === '/' || currentPath.startsWith('/product/')) {
        if (product?.seller_id) {
          navigate(`/seller/${product.seller_id}`, { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      }
    }
  }, [product, navigate, location.pathname]);

  if (isLoading) {
    return (
      <AppLayout showHeader={false}>
        <div className="p-4 space-y-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-8 w-3/4 rounded-lg" />
          <Skeleton className="h-6 w-1/2 rounded-lg" />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout showHeader={false}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <p className="text-lg font-semibold mb-2">Oops!</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          {needsLocation && <PreciseLocationRequiredCard className="mb-4" />}
          <Button onClick={() => navigate('/', { replace: true })}>
            <ArrowLeft size={16} className="mr-2" />
            Go Home
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <>
      <AppLayout showHeader={false}>
        <div className="min-h-[60vh]" />
      </AppLayout>
      <ProductDetailSheet
        product={product}
        open={sheetOpen}
        onOpenChange={handleSheetClose}
      />
    </>
  );
}
