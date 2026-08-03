import { Button } from '@/components/ui/button';
import {
  BUYER_JOURNEYS,
  type BuyerJourneyId,
} from '@/lib/buyer-journey';
import type { SoftListingTag } from '@/lib/listing-intent';
import { ArrowRight, ChevronRight, Calendar, ShoppingCart, MessageCircle, Phone, Clock, KeyRound, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

const JOURNEY_ICONS: Record<BuyerJourneyId, typeof ShoppingCart> = {
  cart: ShoppingCart,
  book: Calendar,
  enquire: MessageCircle,
  contact: Phone,
};

const JOURNEY_HELP: Record<BuyerJourneyId, string> = {
  cart: 'Buyers add to cart and check out',
  book: 'Buyers pick a date or time slot',
  enquire: 'Buyers message you for a quote',
  contact: 'Buyers contact you directly',
};

interface CommerceModelStepProps {
  value: BuyerJourneyId | null;
  softTag: SoftListingTag;
  onChange: (model: BuyerJourneyId) => void;
  onSoftTagChange: (tag: SoftListingTag) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function CommerceModelStep({
  value,
  softTag,
  onChange,
  onSoftTagChange,
  onContinue,
  onBack,
}: CommerceModelStepProps) {
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
        ← Edit what you sell
      </button>

      <div className="grid grid-cols-2 gap-3">
        {BUYER_JOURNEYS.map((journey) => {
          const Icon = JOURNEY_ICONS[journey.id];
          const selected = value === journey.id;
          return (
            <button
              key={journey.id}
              type="button"
              onClick={() => onChange(journey.id)}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
                selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-muted-foreground/30',
              )}
            >
              <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', selected ? 'bg-primary/10' : 'bg-muted')}>
                <Icon size={20} className={selected ? 'text-primary' : 'text-muted-foreground'} />
              </div>
              <span className="text-sm font-medium">{journey.label}</span>
              <span className="text-[10px] text-muted-foreground leading-tight">{JOURNEY_HELP[journey.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Optional tags</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'rental' as const, label: 'Rental', icon: KeyRound },
              { id: 'appointment' as const, label: 'Appointment', icon: Clock },
              { id: 'digital' as const, label: 'Digital', icon: Monitor },
            ] as const
          ).map((tag) => {
            const selected = softTag === tag.id;
            const Icon = tag.icon;
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onSoftTagChange(selected ? null : tag.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-all',
                  selected ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                <Icon size={12} />
                {tag.label}
              </button>
            );
          })}
        </div>
        {softTag === 'digital' && (
          <p className="text-[11px] text-muted-foreground">
            Digital offerings use message/enquire for now — buyers reach out to you.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
          <ArrowRight size={12} />Next: We&apos;ll suggest a category home
        </p>
        <Button className="w-full" onClick={onContinue} disabled={!value}>
          Continue<ChevronRight size={16} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}
