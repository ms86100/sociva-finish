// @ts-nocheck
import { useState, useEffect } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { MessageSquareHeart, ChevronRight, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const RATING_LABELS = [
  'Poor',
  'Fair',
  'Good',
  'Very good',
  'Excellent',
];

interface FeedbackSheetProps {
  triggerLabel?: string;
  onSubmitted?: () => void;
  triggerOpen?: boolean;
  onOpenChange?: () => void;
}

export function FeedbackSheet({ triggerLabel, onSubmitted, triggerOpen, onOpenChange }: FeedbackSheetProps = {}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (triggerOpen) setOpen(true);
  }, [triggerOpen]);

  const handleSubmit = async () => {
    if (!user || rating === 0) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('user_feedback' as any).insert({
        user_id: user.id,
        rating,
        message: message.trim() || null,
        page_context: window.location.pathname,
      });
      if (error) throw error;
      setOpen(false);
      setRating(0);
      setMessage('');
      onSubmitted?.();
      window.setTimeout(() => {
        showFeedback({
          title: 'Feedback received',
          description: 'Thank you. This helps us improve Sociva.',
          variant: 'success',
        });
      }, 320);
    } catch {
      toast.error('Could not submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(v) => { setOpen(v); if (!v) onOpenChange?.(); }}>
      <DrawerTrigger asChild>
        <button className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 active:bg-muted transition-colors w-full">
          <MessageSquareHeart size={18} className="text-muted-foreground shrink-0" />
          <span className="flex-1 text-sm font-medium text-left">{triggerLabel || 'Share Feedback'}</span>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>How was your experience?</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-5">
          <div className="flex justify-center gap-2">
            {RATING_LABELS.map((label, i) => {
              const value = i + 1;
              const active = rating >= value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  className="flex flex-col items-center gap-1.5 px-1"
                  aria-label={`${value} star${value === 1 ? '' : 's'} — ${label}`}
                >
                  <Star
                    size={28}
                    className={cn(
                      'transition-colors',
                      active ? 'fill-primary text-primary' : 'text-muted-foreground/40',
                    )}
                  />
                </button>
              );
            })}
          </div>
          {rating > 0 && (
            <p className="text-center text-sm text-muted-foreground">
              {rating <= 2
                ? 'We are sorry it fell short. Tell us how we can improve.'
                : rating === 3
                  ? 'Thank you — a short note helps us improve.'
                  : 'Glad it went well. We appreciate you taking a moment.'}
            </p>
          )}

          <Textarea
            placeholder="Tell us more (optional)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="text-sm"
          />

          <Button
            onClick={handleSubmit}
            disabled={rating === 0 || isSubmitting}
            className="w-full rounded-xl"
          >
            {isSubmitting ? 'Sending...' : 'Submit feedback'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
