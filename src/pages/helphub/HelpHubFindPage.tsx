// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HelpHubGate } from '@/components/helphub/HelpHubGate';
import { HelpHubListingCard } from '@/components/helphub/HelpHubListingCard';
import { CallFeedbackSheet } from '@/components/helphub/CallFeedbackSheet';
import { ChipPicker } from '@/components/helphub/ChipPicker';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  HELPHUB_AVAILABILITY,
  HELPHUB_CATEGORIES,
  HELPHUB_QUICK_ROLES,
  HELPHUB_WORK_TYPES,
} from '@/lib/helphub/constants';
import {
  useHelpHubContact,
  useHelpHubListings,
  useSubmitHelpHubCallFeedback,
} from '@/hooks/queries/useHelpHub';
import { openHelpHubPhoneCall } from '@/lib/helphub/mock-data';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ChevronDown, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { HelpHubListing } from '@/lib/helphub/types';

export default function HelpHubFindPage() {
  const [category, setCategory] = useState('all');
  const [workType, setWorkType] = useState('all');
  const [availability, setAvailability] = useState('all');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [feedbackListing, setFeedbackListing] = useState<HelpHubListing | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [awaitingReturn, setAwaitingReturn] = useState(false);

  const filters = useMemo(
    () => ({ category, workType, availability, query }),
    [category, workType, availability, query],
  );
  const { data: listings = [], isLoading, isError, usingDemo, refetch } = useHelpHubListings(filters);
  const contact = useHelpHubContact();
  const submitFeedback = useSubmitHelpHubCallFeedback();

  const activeFilterCount =
    (category !== 'all' ? 1 : 0) +
    (workType !== 'all' ? 1 : 0) +
    (availability !== 'all' ? 1 : 0);

  useEffect(() => {
    if (!awaitingReturn || !feedbackListing) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setFeedbackOpen(true);
        setAwaitingReturn(false);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const fallback = window.setTimeout(() => {
      setFeedbackOpen(true);
      setAwaitingReturn(false);
    }, 2500);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearTimeout(fallback);
    };
  }, [awaitingReturn, feedbackListing]);

  const onContact = async (listing: HelpHubListing) => {
    try {
      const phone = await contact.mutateAsync(listing);
      if (!phone) {
        toast.error('Phone number not available for this listing');
        return;
      }
      setFeedbackListing(listing);
      setAwaitingReturn(true);
      openHelpHubPhoneCall(phone);
    } catch (err: any) {
      toast.error(err?.message || 'Could not start call');
    }
  };

  const clearFilters = () => {
    setCategory('all');
    setWorkType('all');
    setAvailability('all');
    setQuery('');
  };

  return (
    <AppLayout headerTitle="Find Help">
      <HelpHubGate>
        <div className="helphub-find-page min-h-[calc(100vh-3.5rem)] pb-24">
          <div className="relative overflow-hidden px-4 pt-4 pb-5">
            <div
              className="pointer-events-none absolute -top-16 right-[-20%] h-44 w-44 rounded-full bg-primary/15 blur-3xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute top-8 left-[-10%] h-28 w-28 rounded-full bg-emerald-400/10 blur-2xl"
              aria-hidden
            />
            <div className="relative">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/90">
                <Sparkles size={12} /> Society HelpHub
              </p>
              <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
                Find help nearby
              </h1>
              <p className="mt-1 text-sm text-muted-foreground max-w-[22rem] leading-relaxed">
                Neighbour-recommended cooks, maids, nannies, and more - search once, call when ready.
                Keep numbers private; do not share outside your society.
              </p>
              {usingDemo && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Sample listings for review - real posts replace these when published.
                </p>
              )}
            </div>
          </div>

          <div className="sticky top-0 z-20 border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, skill, language, flat..."
                className="h-11 rounded-2xl border-border/80 bg-card pl-10 pr-10 shadow-sm"
                autoComplete="off"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setQuery('')}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {HELPHUB_QUICK_ROLES.map((role) => {
                const selected = category === role.value;
                return (
                  <button
                    key={role.value}
                    type="button"
                    onClick={() => setCategory(role.value)}
                    className={cn(
                      'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-all',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm scale-[1.02]'
                        : 'border-border/80 bg-card text-foreground hover:border-primary/35',
                    )}
                  >
                    {role.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1.5 text-[11px] font-medium text-foreground"
              >
                <SlidersHorizontal size={12} />
                More filters
                {activeFilterCount > 0 ? (
                  <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    {activeFilterCount}
                  </span>
                ) : null}
                <ChevronDown
                  size={12}
                  className={cn('transition-transform', filtersOpen && 'rotate-180')}
                />
              </button>
              {(activeFilterCount > 0 || query) && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={clearFilters}>
                  <X size={12} className="mr-1" /> Clear
                </Button>
              )}
            </div>

            {filtersOpen && (
              <div className="mt-3 space-y-3 rounded-2xl border border-border/70 bg-card/90 p-3 shadow-sm">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Role
                  </p>
                  <ChipPicker
                    options={[{ value: 'all', label: 'All roles' }, ...HELPHUB_CATEGORIES]}
                    value={category}
                    onChange={setCategory}
                  />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Work type
                  </p>
                  <ChipPicker
                    options={[{ value: 'all', label: 'Any type' }, ...HELPHUB_WORK_TYPES]}
                    value={workType}
                    onChange={setWorkType}
                  />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Timing
                  </p>
                  <ChipPicker
                    options={[{ value: 'all', label: 'Any time' }, ...HELPHUB_AVAILABILITY]}
                    value={availability}
                    onChange={setAvailability}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="px-4 pt-4 space-y-3">
            {!isLoading && !isError && (
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{listings.length}</span>{' '}
                  {listings.length === 1 ? 'person' : 'people'} available
                </p>
                <Link
                  to="/help-hub/recommend"
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Recommend someone
                </Link>
              </div>
            )}

            {isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-32 w-full rounded-2xl" />
                <Skeleton className="h-32 w-full rounded-2xl" />
                <Skeleton className="h-32 w-full rounded-2xl" />
              </div>
            )}

            {isError && (
              <div className="rounded-2xl border border-border p-4 text-center bg-card">
                <p className="text-sm text-muted-foreground">Could not load listings</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            )}

            {!isLoading && !isError && listings.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-card/80 p-8 text-center">
                <p className="text-sm font-medium">No matches yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try another role, or recommend someone your neighbours may need.
                </p>
                <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={clearFilters}>
                    Clear filters
                  </Button>
                  <Button asChild className="rounded-xl" size="sm">
                    <Link to="/help-hub/recommend">Recommend Someone</Link>
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {listings.map((listing, index) => (
                <HelpHubListingCard
                  key={listing.id}
                  listing={listing}
                  index={index}
                  onContact={onContact}
                  contactPending={contact.isPending}
                />
              ))}
            </div>
          </div>
        </div>

        <CallFeedbackSheet
          open={feedbackOpen}
          listing={feedbackListing}
          submitting={submitFeedback.isPending}
          onOpenChange={(open) => {
            setFeedbackOpen(open);
            if (!open) setFeedbackListing(null);
          }}
          onSubmit={async ({ listingId, outcome, note }) => {
            try {
              await submitFeedback.mutateAsync({ listingId, outcome, note });
              toast.success('Thanks - your note helps keep HelpHub useful');
              setFeedbackOpen(false);
              setFeedbackListing(null);
            } catch (err: any) {
              toast.error(err?.message || 'Could not save feedback');
            }
          }}
        />
      </HelpHubGate>
    </AppLayout>
  );
}
