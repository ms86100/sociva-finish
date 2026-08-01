// @ts-nocheck
import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';

interface ReviewFormProps {
  orderId: string;
  sellerId: string;
  sellerName: string;
  category?: string;
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function ReviewForm({ orderId, sellerId, sellerName, category, onSuccess, trigger }: ReviewFormProps) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewDimensions, setReviewDimensions] = useState<string[]>([]);
  const [dimensionRatings, setDimensionRatings] = useState<Record<string, number>>({});

  // Fetch category-specific review dimensions from DB
  useEffect(() => {
    if (!category || !isOpen) return;
    const fetchDimensions = async () => {
      const { data } = await supabase
        .from('category_config')
        .select('review_dimensions')
        .eq('category', category as any)
        .maybeSingle();
      if (data?.review_dimensions && Array.isArray(data.review_dimensions)) {
        setReviewDimensions(data.review_dimensions as string[]);
      }
    };
    fetchDimensions();
  }, [category, isOpen]);

  const handleSubmit = async () => {
    if (!user || rating === 0) {
      notify.block('Please select a rating');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('reviews').insert({
        order_id: orderId,
        buyer_id: user.id,
        seller_id: sellerId,
        rating,
        comment: comment.trim() || null,
      } as any);

      if (error) throw error;

      // Reputation ledger entry is now handled by the DB trigger (fn_review_after_insert)

      toast.success('Review submitted successfully!');
      setIsOpen(false);
      setRating(0);
      setComment('');
      setDimensionRatings({});
      onSuccess?.();
    } catch (error: any) {
      console.error('Error submitting review:', error);
      if (error.message?.includes('duplicate')) {
        notify.block('You have already reviewed this order');
      } else {
        toast.error('Failed to submit review');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Star size={16} className="mr-1" />
            Write Review
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rate your experience with {sellerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {/* Star Rating */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Tap to rate</p>
            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoveredRating(star)}
                    onMouseLeave={() => setHoveredRating(0)}
                    className="p-1.5 transition-transform hover:scale-110 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  >
                  <Star
                    size={32}
                    className={cn(
                      'transition-colors',
                      (hoveredRating || rating) >= star
                        ? 'fill-warning text-warning'
                        : 'text-muted-foreground'
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="text-sm font-medium mt-2">
              {rating === 1 && 'Poor'}
              {rating === 2 && 'Fair'}
              {rating === 3 && 'Good'}
              {rating === 4 && 'Very Good'}
              {rating === 5 && 'Excellent'}
            </p>
          </div>

          {/* Category-Specific Dimension Ratings */}
          {reviewDimensions.length > 0 && rating > 0 && (
            <div className="space-y-3 p-3 bg-muted rounded-lg">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rate specific aspects</p>
              {reviewDimensions.map((dim) => (
                <div key={dim} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{dim}</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setDimensionRatings(prev => ({ ...prev, [dim]: star }))}
                        className="p-1 min-w-[32px] min-h-[32px] flex items-center justify-center"
                      >
                        <Star
                          size={18}
                          className={cn(
                            'transition-colors',
                            (dimensionRatings[dim] || 0) >= star
                              ? 'fill-warning text-warning'
                              : 'text-muted-foreground/30'
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Comment */}
          <div>
            <Textarea
              placeholder="Share your experience (optional)..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <div className="flex justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">Your review will be shown with your first name. Sellers cannot see your contact details.</p>
              <p className="text-xs text-muted-foreground shrink-0 ml-2">{comment.length}/500</p>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={rating === 0 || isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
