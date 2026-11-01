// @ts-nocheck
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatHelpHubHours,
  HELPHUB_AVAILABILITY,
  HELPHUB_CATEGORIES,
  HELPHUB_WORK_TYPES,
} from '@/lib/helphub/constants';
import type { HelpHubListing } from '@/lib/helphub/types';
import { Clock3, Phone, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

function labelFor(
  items: { value: string; label: string }[],
  value: string,
): string {
  return items.find((i) => i.value === value)?.label || value;
}

interface HelpHubListingCardProps {
  listing: HelpHubListing;
  onContact?: (listing: HelpHubListing) => void;
  contactPending?: boolean;
  index?: number;
}

export function HelpHubListingCard({
  listing,
  onContact,
  contactPending,
  index = 0,
}: HelpHubListingCardProps) {
  const isRecommended =
    listing.source === 'resident_recommendation' || listing.source === 'assisted';
  const initial = (listing.display_name || '?').charAt(0).toUpperCase();
  const hoursLabel = formatHelpHubHours(listing.available_from, listing.available_to);

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border/80 bg-card/95 p-4 shadow-card',
        'food-listing-card-enter backdrop-blur-[2px]',
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <div className="food-listing-sheen opacity-40" aria-hidden />
      <div className="relative flex gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 font-bold text-lg">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                to={`/help-hub/listing/${listing.id}`}
                className="font-semibold text-[15px] text-foreground hover:underline truncate block"
              >
                {listing.display_name}
              </Link>
              <p className="text-xs text-muted-foreground mt-0.5">
                {labelFor(HELPHUB_CATEGORIES, listing.category)} ·{' '}
                {labelFor(HELPHUB_WORK_TYPES, listing.work_type)} ·{' '}
                {labelFor(HELPHUB_AVAILABILITY, listing.availability)}
              </p>
              {hoursLabel && (
                <p className="text-[11px] text-foreground/85 mt-1 flex items-center gap-1">
                  <Clock3 size={11} className="text-primary shrink-0" />
                  {hoursLabel}
                </p>
              )}
            </div>
            <Badge
              variant="secondary"
              className="text-[10px] shrink-0 rounded-full px-2 py-0.5"
            >
              {isRecommended ? 'Neighbour tip' : 'Self listed'}
            </Badge>
          </div>

          {isRecommended && (listing.recommender_name || listing.recommender_flat) && (
            <p className="text-[11px] text-foreground/90 mt-2 flex items-start gap-1.5">
              <UserRound size={12} className="mt-0.5 text-primary shrink-0" />
              <span>
                Recommended by{' '}
                <span className="font-semibold">{listing.recommender_name || 'a resident'}</span>
                {listing.recommender_flat ? (
                  <>
                    {' '}
                    · Flat <span className="font-semibold">{listing.recommender_flat}</span>
                  </>
                ) : null}
              </span>
            </p>
          )}

          {(listing.experience_years != null || listing.expected_salary != null) && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {listing.experience_years != null && `${listing.experience_years} yrs exp`}
              {listing.experience_years != null && listing.expected_salary != null && ' · '}
              {listing.expected_salary != null &&
                `₹${listing.expected_salary.toLocaleString('en-IN')}`}
            </p>
          )}

          {listing.description && (
            <p className="text-xs text-foreground/75 mt-2 line-clamp-2 leading-relaxed">
              {listing.description}
            </p>
          )}

          <div className="mt-3.5 flex justify-end">
            <Button
              size="sm"
              className="rounded-full px-4 h-9 shadow-sm"
              disabled={contactPending}
              onClick={() => onContact?.(listing)}
            >
              <Phone size={14} className="mr-1.5" />
              Contact
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
