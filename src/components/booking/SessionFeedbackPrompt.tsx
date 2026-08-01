// @ts-nocheck
import { useState } from 'react';
import { useSessionFeedback } from '@/hooks/useServiceBookings';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Star, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SessionFeedbackPromptProps {
  bookingId: string;
  bookingStatus: string;
}

export function SessionFeedbackPrompt({ bookingId, bookingStatus }: SessionFeedbackPromptProps) {
  const { user } = useAuth();
  const { data: existingFeedback, refetch } = useSessionFeedback(bookingId);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (bookingStatus !== 'completed') return null;
  if (existingFeedback || submitted) {
    const displayRating = existingFeedback?.rating || rating;
    return (
      <div className="flex items-center gap-2 py-2">
        <Check size={14} className="text-primary" />
        <span className="text-xs text-muted-foreground">Session rated {displayRating}/5</span>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star key={s} size={10} className={s <= displayRating ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground'} />
          ))}
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!user || rating === 0) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('session_feedback').insert({
        booking_id: bookingId,
        buyer_id: user.id,
        rating,
        comment: comment.trim() || null,
      });
      if (error) throw error;
      setSubmitted(true);
      refetch();
      toast.success('Thanks for your feedback!');
    } catch {
      toast.error('Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 space-y-2.5">
      <p className="text-xs font-semibold">How was this session?</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            onMouseEnter={() => setHoverRating(s)}
            onMouseLeave={() => setHoverRating(0)}
            onClick={() => setRating(s)}
            className="p-0.5"
          >
            <Star
              size={22}
              className={cn(
                'transition-colors',
                s <= (hoverRating || rating) ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/40'
              )}
            />
          </button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <Textarea
            placeholder="Optional: Share more details..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-[60px] text-xs resize-none"
            rows={2}
          />
          <Button size="sm" className="h-7 text-xs w-full" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="animate-spin mr-1" size={12} /> : null}
            Submit Rating
          </Button>
        </>
      )}
    </div>
  );
}
