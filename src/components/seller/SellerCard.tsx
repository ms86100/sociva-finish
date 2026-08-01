// @ts-nocheck
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { FavoriteButton } from '@/components/favorite/FavoriteButton';
import { Badge } from '@/components/ui/badge';
import { SellerProfile, Product } from '@/types/database';
import { Clock, MapPin, Award, Zap, Users, Shield, Star, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';
import { computeStoreStatus, formatStoreClosedMessage } from '@/lib/store-availability';

interface SellerCardProps {
  seller: SellerProfile & { profile?: { name: string; block: string }; products?: { price: number }[] };
  featuredProduct?: Product;
  showFavorite?: boolean;
}

/** Compute a 0-100 trust score from seller profile fields */
function computeTrustScore(seller: any): { score: number; label: string; color: string } {
  let score = 0;
  let factors = 0;

  // Factor 1: Rating (0-5 → 0-100)
  if (seller.rating && seller.rating > 0) {
    score += (seller.rating / 5) * 100;
    factors++;
  }

  // Factor 2: Fulfillment (low cancellation = high trust)
  if (seller.cancellation_rate != null && seller.completed_order_count >= 3) {
    score += Math.max(0, 100 - seller.cancellation_rate * 10);
    factors++;
  }

  // Factor 3: Reliability score (direct from DB)
  if (seller.reliability_score != null) {
    score += seller.reliability_score;
    factors++;
  }

  // Factor 4: On-time delivery
  if (seller.on_time_delivery_pct != null) {
    score += seller.on_time_delivery_pct;
    factors++;
  }

  // Factor 5: Activity (responded recently)
  if (seller.last_active_at && isRecentlyActive(seller.last_active_at)) {
    score += 80;
    factors++;
  }

  if (factors === 0) return { score: 0, label: '', color: '' };

  const avg = Math.round(score / factors);
  if (avg >= 85) return { score: avg, label: 'Excellent', color: 'text-success' };
  if (avg >= 70) return { score: avg, label: 'Very Good', color: 'text-primary' };
  if (avg >= 50) return { score: avg, label: 'Good', color: 'text-warning' };
  return { score: avg, label: 'New', color: 'text-muted-foreground' };
}

export function SellerCard({ seller, featuredProduct, showFavorite = true }: SellerCardProps) {
  const storeAvailability = computeStoreStatus(
    seller.availability_start,
    seller.availability_end,
    seller.operating_days,
    seller.is_available ?? true
  );
  const isOpen = storeAvailability.status === 'open';
  const { formatPrice } = useCurrency();
  const profile = seller.profile;
  const isNewSeller = !seller.rating || seller.rating === 0 || seller.total_reviews === 0;
  const minPrice = (seller as any).products?.length
    ? Math.min(...(seller as any).products.map((p: any) => p.price))
    : null;

  const trust = computeTrustScore(seller);

  return (
    <Link to={`/seller/${seller.id}`}>
      <Card className="overflow-hidden hover:shadow-md transition-all border-border/50">
        <div className="relative h-32">
          {seller.cover_image_url ? (
            <img
              src={seller.cover_image_url}
              alt={seller.business_name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center pt-4">
              <span className="text-4xl opacity-40">🏪</span>
            </div>
          )}
          {!isOpen && (
            <div className="absolute inset-0 bg-background/70 backdrop-blur-[2px] flex items-center justify-center">
              <span className="text-foreground font-medium text-sm">
                {storeAvailability.status === 'paused'
                  ? 'Store Paused'
                  : storeAvailability.status === 'closed_today'
                    ? 'Closed Today'
                    : formatStoreClosedMessage(storeAvailability) || 'Currently Closed'}
              </span>
            </div>
          )}
          
          {/* Trust Score Badge */}
          {trust.score > 0 && trust.label && (
            <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-background/90 backdrop-blur-sm text-xs font-semibold flex items-center gap-1">
              <Shield size={12} className={trust.color} />
              <span className={trust.color}>{trust.score}%</span>
            </div>
          )}

          {/* Featured Badge - only show if no trust score */}
          {seller.is_featured && !trust.score && (
            <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-accent text-accent-foreground text-xs font-semibold flex items-center gap-1">
              <Award size={12} />
              Trusted
            </div>
          )}

          {/* Favorite Button */}
          {showFavorite && (
            <div className="absolute top-2 right-2">
              <FavoriteButton sellerId={seller.id} size="sm" />
            </div>
          )}

          {/* Seller Avatar */}
          {seller.profile_image_url && (
            <div className="absolute -bottom-4 left-3 w-12 h-12 rounded-full border-2 border-card overflow-hidden shadow-md">
              <img
                src={seller.profile_image_url}
                alt={seller.business_name}
                className="w-full h-full object-cover"
              />
            </div>
          )}
        </div>
        
        <CardContent className={cn('p-3', seller.profile_image_url && 'pt-5')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold truncate">{seller.business_name}</h3>
              {seller.description && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                  {seller.description}
                </p>
              )}
              {minPrice !== null && (
                <p className="text-xs font-semibold text-success mt-0.5 tabular-nums">
                  Starting from {formatPrice(minPrice)}
                </p>
              )}
            </div>
            {/* Rating + order count */}
            {isNewSeller ? (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 shrink-0">
                New Seller
              </Badge>
            ) : (
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                {seller.rating > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 text-warning font-semibold flex items-center gap-0.5">
                    <Star size={9} fill="currentColor" />
                    {Number(seller.rating).toFixed(1)}
                  </span>
                )}
                {(seller.completed_order_count || 0) > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold flex items-center gap-0.5">
                    <Users size={9} />
                    {seller.completed_order_count}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Location + Hours */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            {profile && (
              <span className="flex items-center gap-1">
                <MapPin size={12} />
                Block {profile.block}
              </span>
            )}
            {seller.availability_start && seller.availability_end && (
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {seller.availability_start.slice(0, 5)} - {seller.availability_end.slice(0, 5)}
              </span>
            )}
          </div>

          {/* Trust signals */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {seller.avg_response_minutes != null && seller.avg_response_minutes > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success flex items-center gap-0.5">
                <Zap size={9} />
                ~{seller.avg_response_minutes}m response
              </span>
            )}
            {seller.last_active_at && isRecentlyActive(seller.last_active_at) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                Active today
              </span>
            )}
            {seller.on_time_delivery_pct != null && seller.on_time_delivery_pct >= 90 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-0.5">
                <TrendingUp size={9} />
                {Math.round(seller.on_time_delivery_pct)}% on-time
              </span>
            )}
            {seller.cancellation_rate != null && seller.cancellation_rate < 5 && (seller.completed_order_count || 0) >= 5 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-0.5">
                <Shield size={9} />
                Reliable
              </span>
            )}
          </div>

          {seller.categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {seller.categories.slice(0, 3).map((cat) => (
                <span
                  key={cat}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                >
                  {cat.replace('_', ' ')}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function isRecentlyActive(lastActive: string): boolean {
  const diff = Date.now() - new Date(lastActive).getTime();
  return diff < 24 * 60 * 60 * 1000;
}