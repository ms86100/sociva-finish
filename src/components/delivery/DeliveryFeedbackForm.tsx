// @ts-nocheck
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { notify } from '@/lib/notify';
import { showFeedback, useFeedbackPopup } from '@/components/FeedbackPopupProvider';

interface DeliveryFeedbackFormProps {
  orderId: string;
  sellerId: string;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function DeliveryFeedbackForm({ orderId, sellerId, trigger, onSuccess }: DeliveryFeedbackFormProps) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating < 1) {
      notify.block('Please select a delivery rating');
      return;
    }

    setSubmitting(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const buyerId = auth.user?.id;
      if (!buyerId) throw new Error('Please sign in again');

      const { error } = await supabase.from('delivery_feedback').insert({
        order_id: orderId,
        buyer_id: buyerId,
        seller_id: sellerId,
        rating,
        comment: comment.trim() || null,
      } as any);

      if (error) throw error;

      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: 'Delivery feedback submitted',
        variant: 'success'
      });
      setOpen(false);
      setRating(0);
      setComment('');
      onSuccess?.();
    } catch (error: any) {
      toast.error(error?.message?.includes('duplicate') ? 'Delivery feedback already submitted' : 'Failed to submit delivery feedback');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button variant="outline" size="sm">Rate Delivery</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rate the delivery experience</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <Star
                  size={28}
                  className={cn(rating >= star ? 'fill-warning text-warning' : 'text-muted-foreground')}
                />
              </button>
            ))}
          </div>

          <Textarea
            placeholder="How was the delivery timing, handoff, and overall experience?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={500}
          />

          <Button className="w-full" onClick={handleSubmit} disabled={submitting || rating < 1}>
            {submitting ? 'Submitting...' : 'Submit Delivery Feedback'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
