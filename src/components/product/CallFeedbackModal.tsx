// @ts-nocheck
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PhoneCall, MessageCircle, Phone } from 'lucide-react';
import { showFeedback } from '@/components/FeedbackPopupProvider';

const OUTCOMES = [
  { value: 'agreement_reached', label: '✅ Agreement reached' },
  { value: 'will_call_back', label: '📞 Will call back later' },
  { value: 'no_answer', label: '📵 No answer' },
  { value: 'busy', label: '🔴 Line was busy' },
  { value: 'wrong_number', label: '❌ Wrong number' },
  { value: 'other', label: '💬 Other' },
];

interface CallFeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interactionId: string | null;
  buyerId: string;
  sellerId: string;
  orderId?: string | null;
  onMessage?: () => void;
  onTryAgain?: () => void;
}

export function CallFeedbackModal({
  open, onOpenChange, interactionId, buyerId, sellerId,
  orderId, onMessage, onTryAgain,
}: CallFeedbackModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selected || !interactionId) return;
    setSubmitting(true);
    try {
      await supabase.from('call_feedback').insert({
        interaction_id: interactionId,
        buyer_id: buyerId,
        seller_id: sellerId,
        outcome: selected,
      });
      if (interactionId) {
        await supabase.rpc('mark_contact_interaction_status', {
          p_interaction_id: interactionId,
          p_status: 'contacted',
        });
      }
      showFeedback({ title: 'Thanks for your feedback!', variant: 'success' });
      onOpenChange(false);
    } catch {
      toast.error('Could not save feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PhoneCall size={16} className="text-primary" />
            How did the call go?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 pt-1">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              onClick={() => setSelected(o.value)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                selected === o.value
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-muted border-transparent text-foreground hover:border-border'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 mt-2">
          <Button onClick={handleSubmit} disabled={!selected || submitting} className="w-full">
            {submitting ? 'Saving...' : 'Submit Feedback'}
          </Button>
          <div className="flex gap-2">
            {onTryAgain && (
              <Button variant="outline" className="flex-1 gap-1" onClick={() => { onOpenChange(false); onTryAgain(); }}>
                <Phone size={14} /> Call again
              </Button>
            )}
            {onMessage && (
              <Button variant="outline" className="flex-1 gap-1" onClick={() => { onOpenChange(false); onMessage(); }}>
                <MessageCircle size={14} /> Message
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={handleSkip} className="text-muted-foreground">
            Skip for now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
