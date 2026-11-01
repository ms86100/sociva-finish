// @ts-nocheck
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HelpHubGate } from '@/components/helphub/HelpHubGate';
import { CallFeedbackSheet } from '@/components/helphub/CallFeedbackSheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  formatHelpHubHours,
  HELPHUB_AVAILABILITY,
  HELPHUB_CATEGORIES,
  HELPHUB_REPORT_REASONS,
  HELPHUB_SOURCE_LABELS,
  HELPHUB_WORK_TYPES,
} from '@/lib/helphub/constants';
import {
  useHelpHubContact,
  useHelpHubListing,
  useHelpHubOwnerActions,
  useReportHelpHubListing,
  useSubmitHelpHubCallFeedback,
} from '@/hooks/queries/useHelpHub';
import { openHelpHubPhoneCall } from '@/lib/helphub/mock-data';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Flag, Loader2, Phone, Share2 } from 'lucide-react';

function labelFor(items: { value: string; label: string }[], value: string) {
  return items.find((i) => i.value === value)?.label || value;
}

export default function HelpHubListingPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: listing, isLoading } = useHelpHubListing(id);
  const contact = useHelpHubContact();
  const reportListing = useReportHelpHubListing();
  const submitFeedback = useSubmitHelpHubCallFeedback();
  const { markHired, renew, remove } = useHelpHubOwnerActions();
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState(HELPHUB_REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [awaitingReturn, setAwaitingReturn] = useState(false);

  const isOwner = listing && user?.id && listing.created_by === user.id;
  const isRecommended =
    listing &&
    (listing.source === 'resident_recommendation' || listing.source === 'assisted');

  useEffect(() => {
    if (!awaitingReturn || !listing) return;
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
  }, [awaitingReturn, listing]);

  const onContact = async () => {
    if (!listing) return;
    try {
      const phone = await contact.mutateAsync(listing);
      if (!phone) {
        toast.error('Phone number not available for this listing');
        return;
      }
      setAwaitingReturn(true);
      openHelpHubPhoneCall(phone);
    } catch (err: any) {
      toast.error(err?.message || 'Could not start call');
    }
  };

  const onShare = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/help-hub/listing/${id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `HelpHub - ${listing?.display_name}`,
          text: `${listing?.display_name} is available on Sociva HelpHub`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied');
      }
    } catch {
      /* user cancelled */
    }
  };

  const onReport = async () => {
    if (!listing) return;
    try {
      await reportListing.mutateAsync({
        listingId: listing.id,
        reason: reportReason,
        details: reportDetails,
      });
      toast.success('Report submitted');
      setReportOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'Could not submit report');
    }
  };

  return (
    <AppLayout headerTitle="Listing">
      <HelpHubGate>
        <div className="p-4 pb-24 space-y-4">
          {isLoading && <Skeleton className="h-48 w-full rounded-2xl" />}

          {!isLoading && !listing && (
            <div className="rounded-2xl border border-border p-6 text-center">
              <p className="text-sm">Listing not found or no longer active</p>
            </div>
          )}

          {listing && (
            <>
              <div className="rounded-2xl border border-border bg-card p-4 shadow-card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-bold">{listing.display_name}</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                      {labelFor(HELPHUB_CATEGORIES, listing.category)} ·{' '}
                      {labelFor(HELPHUB_WORK_TYPES, listing.work_type)} ·{' '}
                      {labelFor(HELPHUB_AVAILABILITY, listing.availability)}
                    </p>
                    {formatHelpHubHours(listing.available_from, listing.available_to) && (
                      <p className="text-sm font-medium text-foreground mt-1.5">
                        Hours:{' '}
                        {formatHelpHubHours(listing.available_from, listing.available_to)}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {HELPHUB_SOURCE_LABELS[listing.source]}
                  </Badge>
                </div>

                {isRecommended && (listing.recommender_name || listing.recommender_flat) && (
                  <p className="text-sm font-medium text-foreground">
                    Recommended by {listing.recommender_name || 'a resident'}
                    {listing.recommender_flat ? ` · Flat ${listing.recommender_flat}` : ''}
                  </p>
                )}

                {listing.description && (
                  <p className="text-sm text-foreground/90">{listing.description}</p>
                )}

                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {listing.experience_years != null && (
                    <span>{listing.experience_years} yrs experience</span>
                  )}
                  {listing.expected_salary != null && (
                    <span>₹{listing.expected_salary.toLocaleString('en-IN')}</span>
                  )}
                  {listing.tower_or_block && <span>{listing.tower_or_block}</span>}
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Tap Contact to call them directly. Keep the number private - do not forward it outside your society.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Button className="rounded-xl h-11" onClick={onContact} disabled={contact.isPending}>
                  {contact.isPending ? (
                    <Loader2 size={16} className="mr-2 animate-spin" />
                  ) : (
                    <Phone size={16} className="mr-2" />
                  )}
                  Contact
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={onShare}>
                  <Share2 size={16} className="mr-2" /> Share
                </Button>
                {!isOwner && (
                  <Button variant="ghost" className="rounded-xl" onClick={() => setReportOpen(true)}>
                    <Flag size={14} className="mr-2" /> Report
                  </Button>
                )}
              </div>

              {isOwner && (
                <div className="rounded-2xl border border-border p-4 space-y-2">
                  <p className="text-xs font-semibold">Manage listing</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        renew.mutate(listing.id, {
                          onSuccess: () => toast.success('Listing renewed for 30 days'),
                          onError: (e: any) => toast.error(e?.message || 'Renew failed'),
                        })
                      }
                    >
                      Renew
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        markHired.mutate(listing.id, {
                          onSuccess: () => toast.success('Marked as hired'),
                          onError: (e: any) => toast.error(e?.message || 'Update failed'),
                        })
                      }
                    >
                      Mark hired
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        remove.mutate(listing.id, {
                          onSuccess: () => toast.success('Listing removed'),
                          onError: (e: any) => toast.error(e?.message || 'Remove failed'),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <Sheet open={reportOpen} onOpenChange={setReportOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Report listing</SheetTitle>
              <SheetDescription>Help keep HelpHub safe for your society.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-3">
              <Select value={reportReason} onValueChange={setReportReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HELPHUB_REPORT_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Optional details"
                rows={3}
              />
              <Button
                className="w-full rounded-xl"
                onClick={onReport}
                disabled={reportListing.isPending}
              >
                Submit report
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <CallFeedbackSheet
          open={feedbackOpen}
          listing={listing || null}
          submitting={submitFeedback.isPending}
          onOpenChange={setFeedbackOpen}
          onSubmit={async ({ listingId, outcome, note }) => {
            try {
              await submitFeedback.mutateAsync({ listingId, outcome, note });
              toast.success('Thanks - your note helps keep HelpHub useful');
              setFeedbackOpen(false);
            } catch (err: any) {
              toast.error(err?.message || 'Could not save feedback');
            }
          }}
        />
      </HelpHubGate>
    </AppLayout>
  );
}
