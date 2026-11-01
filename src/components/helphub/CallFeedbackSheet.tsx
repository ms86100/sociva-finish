// @ts-nocheck
import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  HELPHUB_CALL_FEEDBACK_OPTIONS,
  type HelpHubCallFeedbackValue,
} from '@/lib/helphub/constants';
import type { HelpHubListing } from '@/lib/helphub/types';
import { Loader2 } from 'lucide-react';

interface CallFeedbackSheetProps {
  open: boolean;
  listing: HelpHubListing | null;
  submitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    listingId: string;
    outcome: HelpHubCallFeedbackValue;
    note?: string;
  }) => void;
}

export function CallFeedbackSheet({
  open,
  listing,
  submitting,
  onOpenChange,
  onSubmit,
}: CallFeedbackSheetProps) {
  const [outcome, setOutcome] = useState<HelpHubCallFeedbackValue | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setOutcome(null);
      setNote('');
    }
  }, [open, listing?.id]);

  const needsNote = outcome === 'other';
  const canSubmit =
    !!listing &&
    !!outcome &&
    (!needsNote || note.trim().length >= 3) &&
    !submitting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[88vh] overflow-y-auto pb-8">
        <SheetHeader className="text-left space-y-1">
          <SheetTitle className="text-lg">How did the call go?</SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            {listing
              ? `Quick note about your call with ${listing.display_name}. This helps neighbours know what to expect - keep it kind and factual.`
              : 'Share a quick update after your call.'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {HELPHUB_CALL_FEEDBACK_OPTIONS.map((opt) => {
            const selected = outcome === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setOutcome(opt.value)}
                className={cn(
                  'w-full text-left rounded-2xl border px-3.5 py-3 transition-colors',
                  selected
                    ? 'border-primary bg-primary/8 shadow-sm'
                    : 'border-border bg-card hover:border-primary/30',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 h-4 w-4 rounded-full border shrink-0',
                      selected ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {opt.hint}
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {(needsNote || outcome) && (
          <div className="mt-4 space-y-1.5">
            <p className="text-xs font-semibold text-foreground">
              {needsNote ? 'Please add a short note' : 'Anything to add? (optional)'}
            </p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                needsNote
                  ? 'A short, factual note helps other residents'
                  : 'Optional context for society admins'
              }
              rows={3}
              maxLength={280}
              className="rounded-xl text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Avoid personal attacks. Do not share private details you would not want posted.
            </p>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1 rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Skip for now
          </Button>
          <Button
            className="flex-1 rounded-xl"
            disabled={!canSubmit}
            onClick={() => {
              if (!listing || !outcome) return;
              onSubmit({
                listingId: listing.id,
                outcome,
                note: note.trim() || undefined,
              });
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="mr-1.5 animate-spin" /> Saving
              </>
            ) : (
              'Submit'
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
