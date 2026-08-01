// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProductDetailSheet } from '@/components/product/ProductDetailSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function ProductDeepLinkPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
            prep_time_minutes, delivery_time_text, action_type,
            contact_phone, specifications, seller_id,
            seller:seller_profiles!products_seller_id_fkey(
              id, business_name, rating, total_reviews, society_id,
              latitude, longitude,
              society:societies(name)
            )
          `)
          .eq('id', productId)
          .eq('is_available', true)
          .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!data) {
          setError('Product not found or no longer available');
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
          action_type: data.action_type,
          contact_phone: data.contact_phone,
          specifications: data.specifications,
          seller_id: seller?.id || data.seller_id,
          seller_name: seller?.business_name || '',
          seller_rating: seller?.rating || 0,
          seller_reviews: seller?.total_reviews || 0,
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
  }, [productId]);

  const handleSheetClose = useCallback((open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      // Navigate to seller page or home
      if (product?.seller_id) {
        navigate(`/seller/${product.seller_id}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [product, navigate]);

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
