// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Review } from '@/types/database';
import { Star, User } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface ReviewListProps {
  sellerId: string;
  limit?: number;
  showAll?: boolean;
}

export function ReviewList({ sellerId, limit = 5, showAll = false }: ReviewListProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchReviews();
  }, [sellerId]);

  const fetchReviews = async () => {
    try {
      let query = supabase
        .from('reviews')
        .select(`
          *,
          buyer:profiles!reviews_buyer_id_fkey(name, avatar_url)
        `, { count: 'exact' })
        .eq('seller_id', sellerId)
        .eq('is_hidden', false)
        .order('created_at', { ascending: false });

      if (!showAll) {
        query = query.limit(limit);
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setReviews((data as any) || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching reviews:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-8 bg-muted/50 rounded-lg">
        <Star className="mx-auto text-muted-foreground mb-2" size={32} />
        <p className="text-muted-foreground">No reviews yet</p>
        <p className="text-sm text-muted-foreground">Be the first to review!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reviews.map((review) => (
        <div key={review.id} className="bg-card rounded-lg p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              {(review as any).buyer?.avatar_url ? (
                <img
                  src={(review as any).buyer.avatar_url}
                  alt={(review as any).buyer?.name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User size={20} className="text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm">
                  {(review as any).buyer?.name || 'Anonymous'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(review.created_at), 'MMM d, yyyy')}
                </p>
              </div>
              <div className="flex items-center gap-0.5 mt-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={14}
                    className={cn(
                      review.rating >= star
                        ? 'fill-warning text-warning'
                        : 'text-muted-foreground'
                    )}
                  />
                ))}
              </div>
              {review.comment && (
                <p className="text-sm text-muted-foreground mt-2">
                  {review.comment}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}

      {!showAll && totalCount > limit && (
        <p className="text-center text-sm text-primary">
          +{totalCount - limit} more reviews
        </p>
      )}
    </div>
  );
}
