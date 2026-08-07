// @ts-nocheck
import { useState, useEffect } from 'react';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { SellerProfile } from '@/types/database';
import { Heart, ArrowLeft, Store, ShoppingBag } from 'lucide-react';
import { LottieEmptyState } from '@/components/ui/LottieEmptyState';
import { FavoriteButton } from '@/components/favorite/FavoriteButton';
import { ProductFavoriteButton } from '@/components/favorite/ProductFavoriteButton';
import { useProductFavoritesList } from '@/hooks/useProductFavorites';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useCurrency } from '@/hooks/useCurrency';
import { computeStoreStatus, formatStoreClosedMessage } from '@/lib/store-availability';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { cn } from '@/lib/utils';

export default function FavoritesPage() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [favorites, setFavorites] = useState<SellerProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { data: savedProducts = [], isLoading: productsLoading } = useProductFavoritesList();

  useEffect(() => {
    if (user) {
      fetchFavorites();
    }
  }, [user, location.key]);

  const fetchFavorites = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('favorites')
        .select(`
          seller:seller_profiles(
            *,
            profile:profiles!seller_profiles_user_id_fkey(name, block)
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const sellers = data
        ?.map((f: any) => f.seller)
        .filter((s: any) => s && s.verification_status === 'approved') || [];
      
      setFavorites(sellers);
    } catch (error) {
      console.error('Error fetching favorites:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoved = (sellerId: string) => {
    setFavorites(prev => prev.filter(s => s.id !== sellerId));
  };

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3.5 flex items-center gap-3">
        <button onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-bold text-foreground">Favourites</h1>
      </div>
      </SafeHeader>

      <div className="p-4">
        <Tabs defaultValue="sellers" className="w-full">
          <TabsList className="w-full grid grid-cols-2 mb-4">
            <TabsTrigger value="sellers" className="gap-1.5 text-xs">
              <Store size={14} />
              Sellers {favorites.length > 0 && `(${favorites.length})`}
            </TabsTrigger>
            <TabsTrigger value="products" className="gap-1.5 text-xs">
              <ShoppingBag size={14} />
              Products {savedProducts.length > 0 && `(${savedProducts.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sellers">
            {isLoading ? (
              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="aspect-square rounded-2xl" />
                ))}
              </div>
            ) : favorites.length > 0 ? (
              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                {favorites.map((seller) => (
                  <FavoriteSellerCard
                    key={seller.id}
                    seller={seller}
                    onRemoved={() => handleRemoved(seller.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-16">
                <LottieEmptyState
                  emoji="❤️"
                  title="No favourite sellers"
                  description="Tap the heart icon on any store to save it here"
                >
                  <Link to="/" className="text-sm font-semibold text-accent">Browse stores →</Link>
                </LottieEmptyState>
              </div>
            )}
          </TabsContent>

          <TabsContent value="products">
            {productsLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-3.5">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-48 rounded-2xl" />
                ))}
              </div>
            ) : savedProducts.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-3.5">
                {savedProducts.map((product: any) => (
                  <Link
                    key={product.id}
                    to={`/product/${product.id}`}
                    className="group/fav block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-card transition-[box-shadow,border-color] duration-200 hover:shadow-elevated hover:border-border">
                      <div className="aspect-square product-image-bg relative">
                        {product.image_url ? (
                          <img
                            src={optimizedImageUrl(product.image_url, { width: 400, quality: 78 })}
                            alt={product.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover/fav:scale-[1.03]"
                            loading="lazy"
                            decoding="async"
                            onError={handleImageError}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ShoppingBag size={28} className="text-muted-foreground" aria-hidden />
                          </div>
                        )}
                        <div
                          className="absolute top-1.5 right-1.5 z-10"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        >
                          <ProductFavoriteButton
                            productId={product.id}
                            initialFavorite={true}
                            size="sm"
                            className="bg-card/90 backdrop-blur-md shadow-sm border border-border/40"
                          />
                        </div>
                      </div>
                      <div className="p-2.5">
                        <p className="text-xs font-semibold text-foreground line-clamp-2 leading-snug">{product.name}</p>
                        {product.seller_name && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{product.seller_name}</p>
                        )}
                        <p className="text-sm font-extrabold text-foreground mt-1 tabular-nums">{formatPrice(product.price)}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-16">
                <LottieEmptyState
                  emoji="🛍️"
                  title="No saved products"
                  description="Tap the heart icon on any product to save it here"
                >
                  <Link to="/" className="text-sm font-semibold text-accent">Browse products →</Link>
                </LottieEmptyState>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function FavoriteSellerCard({ seller, onRemoved }: { seller: any; onRemoved: () => void }) {
  const storeStatus = computeStoreStatus(
    seller.availability_start,
    seller.availability_end,
    seller.operating_days,
    seller.is_available !== false
  );
  const isOpen = storeStatus.status === 'open';
  const closedMsg = !isOpen ? formatStoreClosedMessage(storeStatus) : '';

  return (
    <Link
      to={`/seller/${seller.id}`}
      className="group/fav-seller block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div
        className={cn(
          'relative rounded-2xl border border-border/60 bg-card overflow-hidden shadow-card',
          'transition-[box-shadow,border-color] duration-200 hover:shadow-elevated hover:border-border',
          !isOpen && 'opacity-60'
        )}
      >
        <div className="aspect-square product-image-bg flex items-center justify-center relative">
          {seller.profile_image_url || seller.cover_image_url ? (
            <img
              src={optimizedImageUrl(seller.profile_image_url || seller.cover_image_url, { width: 300, quality: 78 })}
              alt={seller.business_name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover/fav-seller:scale-[1.03]"
              loading="lazy"
              decoding="async"
              onError={handleImageError}
            />
          ) : (
            <Store size={28} className="text-muted-foreground" aria-hidden />
          )}
          {!isOpen && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-[5]">
              <span className="text-[10px] font-semibold text-muted-foreground bg-card/90 px-2 py-0.5 rounded-full border border-border/50">
                {closedMsg || 'Closed'}
              </span>
            </div>
          )}
          <div
            className="absolute top-1.5 right-1.5 z-10"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <FavoriteButton
              sellerId={seller.id}
              initialFavorite={true}
              size="sm"
              onToggle={(isFav) => { if (!isFav) onRemoved(); }}
            />
          </div>
        </div>
        <div className="p-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', isOpen ? 'bg-success' : 'bg-muted-foreground')} />
            <p className="text-xs font-semibold text-foreground truncate leading-tight">
              {seller.business_name}
            </p>
          </div>
          <div className="flex items-center gap-1 mt-0.5 min-w-0">
            {seller.rating > 0 && (
              <span className="text-[10px] text-foreground font-bold flex items-center gap-0.5 shrink-0">
                ★ {Number(seller.rating).toFixed(1)}
              </span>
            )}
            {seller.category && (
              <span className="text-[10px] text-muted-foreground truncate capitalize">{String(seller.category).replace(/_/g, ' ')}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
