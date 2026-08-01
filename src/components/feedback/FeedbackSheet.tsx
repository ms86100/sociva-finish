// @ts-nocheck
import { useState, useEffect } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { MessageSquareHeart } from 'lucide-react';

const EMOJIS = ['😞', '😐', '🙂', '😊', '🤩'];

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
      toast.success('Thank you for your feedback! 💛');
      setOpen(false);
      setRating(0);
      setMessage('');
      onSubmitted?.();
    } catch {
      toast.error('Failed to submit feedback. Please try again.');
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
          <span className="text-muted-foreground">›</span>
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>How's your experience?</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-5">
          {/* Emoji Rating */}
          <div className="flex justify-center gap-4">
            {EMOJIS.map((emoji, i) => {
              const value = i + 1;
              return (
                <button
                  key={value}
                  onClick={() => setRating(value)}
                  className={`text-3xl transition-transform ${
                    rating === value ? 'scale-125' : 'opacity-50 hover:opacity-80'
                  }`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
          {rating > 0 && (
            <p className="text-center text-sm text-muted-foreground">
              {rating <= 2 ? "We're sorry to hear that." : rating === 3 ? 'Thanks for letting us know.' : 'Glad you like it!'}
            </p>
          )}

          {/* Message */}
          <Textarea
            placeholder="Tell us more (optional)..."
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
            {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
