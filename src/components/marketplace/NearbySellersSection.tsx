// @ts-nocheck
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarketplaceData } from '@/hooks/queries/useMarketplaceData';
import { useAuth } from '@/contexts/AuthContext';
import { MapPin, Store } from 'lucide-react';
import { motion } from 'framer-motion';
import { staggerContainer, cardEntrance } from '@/lib/motion-variants';

export function NearbySellersSection() {
  const { profile } = useAuth();
  const { data: sellers } = useMarketplaceData();
  const navigate = useNavigate();

  const nearbySellers = useMemo(() => {
    if (!sellers || !profile?.society_id) return [];

    const localSellers = sellers.filter(
      (s: any) => !s.society_name || s.distance_km === 0 || s.distance_km === null
    );

    if (localSellers.length >= 5) return [];

    return sellers
      .filter((s: any) => s.distance_km && s.distance_km > 0 && s.is_available)
      .sort((a: any, b: any) => (a.distance_km || 999) - (b.distance_km || 999))
      .slice(0, 6);
  }, [sellers, profile?.society_id]);

  if (nearbySellers.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="px-4 py-3"
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-primary" />
          <h3 className="text-sm font-semibold">Nearby Sellers</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">Beyond your society</span>
      </div>

      <motion.div
        className="flex gap-3 overflow-x-auto scrollbar-hide pb-1"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {nearbySellers.map((seller: any) => (
          <motion.button
            key={seller.seller_id}
            variants={cardEntrance}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate(`/seller/${seller.seller_id}`)}
            className="flex-shrink-0 w-[140px] bg-card border border-border rounded-xl p-3 text-left"
          >
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted mb-2">
              {seller.cover_image_url ? (
                <img
                  src={seller.cover_image_url}
                  alt={seller.business_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Store size={18} className="text-muted-foreground" />
                </div>
              )}
            </div>
            <p className="text-xs font-semibold truncate">{seller.business_name}</p>
            {seller.society_name && (
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                {seller.society_name}
              </p>
            )}
            <div className="flex items-center gap-1 mt-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {seller.distance_km < 1
                  ? `${Math.round(seller.distance_km * 1000)}m`
                  : `${seller.distance_km.toFixed(1)} km`}
              </span>
              {seller.rating > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  ⭐ {Number(seller.rating).toFixed(1)}
                </span>
              )}
            </div>
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  );
}
