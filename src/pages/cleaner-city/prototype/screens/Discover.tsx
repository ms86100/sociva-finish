import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, HelpCircle, MessageCircle } from 'lucide-react';
import { useProto } from '../store';
import {
  AlongYourWay,
  DayChips,
  Field,
  InitialsAvatar,
  MapPlane,
  ProtoBtn,
  ProtoCard,
  ProtoPage,
  SeatStepper,
  Segmented,
  StatusPill,
  ToggleRow,
  TrustChip,
  VerticalRoute,
} from '../ui';
import type { Offer } from '../types';
import { cn } from '@/lib/utils';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function MatchCard({
  offer,
  pending,
  canRequest,
  onRequest,
  onMessage,
  pickupLabel,
  dropoffLabel,
}: {
  offer: Offer;
  pending: boolean;
  canRequest: boolean;
  onRequest: () => void;
  onMessage: () => void;
  pickupLabel: string;
  dropoffLabel: string;
}) {
  const [open, setOpen] = useState(!!offer.bestFit);

  return (
    <ProtoCard className="space-y-3">
      {offer.bestFit ? (
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
          <span className="inline-block h-1.5 w-1.5 rounded-sm bg-emerald-700" aria-hidden />
          Best route overlap for you
        </p>
      ) : null}

      <div className="flex items-start gap-3">
        <InitialsAvatar name={offer.hostName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{offer.hostName}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {offer.communityVerified ? <TrustChip>Community profile</TrustChip> : null}
                {offer.officeVerified ? <TrustChip tone="muted">Office email</TrustChip> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {offer.rating} rating · {offer.ridesDone} shared rides · {offer.vehicleLabel}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background"
              aria-label="Message host"
              onClick={onMessage}
            >
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      <VerticalRoute
        from={pickupLabel}
        to={dropoffLabel}
        leaveTime={offer.time}
        arriveTime={offer.arriveTime}
        durationMin={offer.durationMin}
      />

      <AlongYourWay stops={offer.stops} />

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-base font-semibold">
            ₹{offer.fuelEstimate} <span className="text-xs font-normal text-muted-foreground">shared cost / seat</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {offer.seatsOpen} seats open
            {offer.tags.length ? ` · ${offer.tags.slice(0, 2).join(' · ')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs font-semibold text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Less ^' : 'Details'}
          </button>
          <ProtoBtn
            className="h-10 min-h-10 px-3"
            disabled={pending || !canRequest || !offer.requestable}
            onClick={onRequest}
          >
            {pending && offer.requestable ? 'Requested' : 'Request seat'}
          </ProtoBtn>
        </div>
      </div>

      {open ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground">
            Pickup near {offer.stops[0] || pickupLabel} · Mon, Tue, Wed, Thu, Fri
            {offer.why[0] ? ` · ${offer.why[0]}` : ''}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {offer.tags.map((t) => (
              <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t}
              </span>
            ))}
            {offer.officeVerified ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Verified
              </span>
            ) : null}
          </div>
          <button type="button" className="text-xs font-semibold text-emerald-800" onClick={onMessage}>
            Message host about this stop →
          </button>
          {!offer.requestable ? (
            <p className="text-[11px] text-muted-foreground">Preview match - demo ride uses Arjun’s Best overlap offer.</p>
          ) : null}
          {offer.requestable && !canRequest ? (
            <p className="text-xs text-amber-800">Switch to Priya to request this seat.</p>
          ) : null}
        </div>
      ) : null}
    </ProtoCard>
  );
}

export function DiscoverScreen() {
  const { state, dispatch, me } = useProto();
  const navigate = useNavigate();
  const draft = state.offerDraft;
  const search = state.findSearch;
  const pending = state.ride?.status === 'requested';
  const hostOffer = state.offers[0];
  const pendingNav = useRef<'rides' | `ride:${string}` | null>(null);

  useEffect(() => {
    if (pendingNav.current === 'rides' && state.ride?.status === 'requested') {
      pendingNav.current = null;
      navigate('/cleaner-city/prototype/rides');
    }
    if (
      pendingNav.current?.startsWith('ride:') &&
      state.ride &&
      state.ride.status === 'confirmed'
    ) {
      pendingNav.current = null;
      navigate(`/cleaner-city/prototype/ride/${state.ride.id}`);
    }
  }, [state.ride, navigate]);

  const visibleMatches = useMemo(() => {
    let list = state.findMatches.filter((o) => o.published);
    if (search.verifiedOnly) list = list.filter((o) => o.officeVerified);
    if (!search.searched) return [];
    return list;
  }, [state.findMatches, search.verifiedOnly, search.searched]);

  return (
    <ProtoPage>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {state.mode === 'find' ? 'Where are you headed?' : 'Offer a ride'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {state.mode === 'find'
              ? 'Find neighbours already driving your corridor.'
              : 'Share your everyday route and split the journey.'}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground"
          onClick={() =>
            dispatch({
              type: 'setDemoHint',
              hint: 'How it works: verify work email → find or offer on your corridor → meet with OTP → share the road.',
            })
          }
        >
          <HelpCircle className="h-3.5 w-3.5" />
          How it works
        </button>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto border-b border-border/70 text-sm font-semibold">
        {(
          [
            { id: 'find', label: 'Find a ride' },
            { id: 'rides', label: 'My rides' },
            { id: 'offer', label: 'Host dashboard' },
          ] as const
        ).map((tab) => {
          const active =
            tab.id === 'rides'
              ? false
              : state.mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'whitespace-nowrap border-b-2 pb-2 pt-1 transition',
                active
                  ? 'border-emerald-800 text-emerald-900'
                  : 'border-transparent text-muted-foreground',
              )}
              onClick={() => {
                if (tab.id === 'rides') {
                  navigate('/cleaner-city/prototype/rides');
                  return;
                }
                dispatch({ type: 'setMode', mode: tab.id });
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <ProtoBtn
          variant="secondary"
          className="flex-1 gap-1.5"
          onClick={() => dispatch({ type: 'setSheet', sheet: 'verify-email' })}
        >
          <Building2 className="h-4 w-4" />
          Verify office email
        </ProtoBtn>
        <ProtoBtn
          className="flex-1"
          onClick={() => dispatch({ type: 'setMode', mode: 'offer' })}
        >
          + Offer a ride
        </ProtoBtn>
      </div>

      {state.mode === 'find' ? (
        <div className="space-y-3">
          <ProtoCard className="space-y-3">
            <p className="text-sm font-semibold">Find your next ride</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field
                label="Pickup"
                value={search.pickup}
                onChange={(v) => dispatch({ type: 'patchFindSearch', patch: { pickup: v } })}
              />
              <Field
                label="Drop-off"
                value={search.dropoff}
                onChange={(v) => dispatch({ type: 'patchFindSearch', patch: { dropoff: v } })}
              />
              <Field
                label="Date"
                value={search.date}
                onChange={(v) => dispatch({ type: 'patchFindSearch', patch: { date: v } })}
              />
              <Field
                label="Leaving"
                value={search.leaveTime}
                onChange={(v) => dispatch({ type: 'patchFindSearch', patch: { leaveTime: v } })}
              />
            </div>
            <SeatStepper
              value={search.seatsNeeded}
              onChange={(n) => dispatch({ type: 'patchFindSearch', patch: { seatsNeeded: n } })}
              label="Seats needed"
            />
            <div className="space-y-2">
              <ToggleRow
                label="Flexible pickup"
                checked={search.flexible}
                onChange={(v) => dispatch({ type: 'patchFindSearch', patch: { flexible: v } })}
              />
              <ToggleRow
                label="Verified profiles only"
                checked={search.verifiedOnly}
                onChange={(v) => dispatch({ type: 'patchFindSearch', patch: { verifiedOnly: v } })}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Usual days
              </p>
              <DayChips days={WEEK} selected={search.days} onToggle={(d) => dispatch({ type: 'toggleFindDay', day: d })} />
            </div>
            <ProtoBtn className="w-full" onClick={() => dispatch({ type: 'runFindSearch' })}>
              Search rides
            </ProtoBtn>
          </ProtoCard>

          <MapPlane
            label={`${search.pickup.split(',')[0]} → ${search.dropoff}`}
            meta={`${visibleMatches.length} rides nearby · avg ~₹${visibleMatches[0]?.fuelEstimate ?? 60}`}
            compact
          />

          <ProtoCard>
            <p className="text-sm font-semibold">Your commute snapshot</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-secondary p-2">
                <p className="font-semibold">{visibleMatches.length}</p>
                <p className="text-muted-foreground">Nearby</p>
              </div>
              <div className="rounded-xl bg-secondary p-2">
                <p className="font-semibold">₹{visibleMatches[0]?.fuelEstimate ?? 60}</p>
                <p className="text-muted-foreground">Typical</p>
              </div>
              <div className="rounded-xl bg-secondary p-2">
                <p className="font-semibold">{visibleMatches[0]?.durationMin ?? 34}m</p>
                <p className="text-muted-foreground">Trip</p>
              </div>
            </div>
          </ProtoCard>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Community rides along your way</h2>
            <span className="text-xs text-muted-foreground">{visibleMatches.length} rides</span>
          </div>

          {visibleMatches.length === 0 ? (
            <ProtoCard>
              <p className="font-semibold">No matches right now</p>
              <p className="mt-1 text-sm text-muted-foreground">Join the waitlist or offer your own seats.</p>
              <div className="mt-3 flex gap-2">
                <ProtoBtn className="flex-1" onClick={() => dispatch({ type: 'toggleWaitlist' })}>
                  {state.waitlisted ? 'Leave waitlist' : 'Join waitlist'}
                </ProtoBtn>
                <ProtoBtn
                  variant="secondary"
                  className="flex-1"
                  onClick={() => dispatch({ type: 'setMode', mode: 'offer' })}
                >
                  Offer a seat
                </ProtoBtn>
              </div>
            </ProtoCard>
          ) : (
            visibleMatches.map((offer) => (
              <MatchCard
                key={offer.id}
                offer={offer}
                pending={pending && state.ride?.offerId === offer.id}
                canRequest={state.perspective === 'priya'}
                pickupLabel={search.pickup}
                dropoffLabel={search.dropoff}
                onRequest={() => {
                  pendingNav.current = 'rides';
                  dispatch({ type: 'requestSeat', offerId: offer.id });
                }}
                onMessage={() =>
                  dispatch({
                    type: 'setDemoHint',
                    hint: `Message ${offer.hostName} (mock chat). Full chat opens once a seat is confirmed.`,
                  })
                }
              />
            ))
          )}

          {state.waitlisted ? (
            <p className="text-center text-xs font-medium text-emerald-800">Waitlist on for this corridor</p>
          ) : null}

          <ProtoBtn
            variant="secondary"
            className="w-full"
            onClick={() => dispatch({ type: 'setMode', mode: 'offer' })}
          >
            + Offer a ride on this route
          </ProtoBtn>
        </div>
      ) : (
        <div className="space-y-3">
          {pending && state.ride ? (
            <ProtoCard>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Seat requests</p>
                <StatusPill tone="warn">1 waiting</StatusPill>
              </div>
              <p className="text-sm font-medium">Priya Mehta · Infosys · 4.9★</p>
              <p className="text-xs text-muted-foreground">Morning commute · {hostOffer?.time || '08:35'}</p>
              <div className="mt-3 flex gap-2">
                <ProtoBtn
                  variant="secondary"
                  className="flex-1"
                  disabled={state.perspective !== 'arjun'}
                  onClick={() => dispatch({ type: 'declineRequest' })}
                >
                  Decline
                </ProtoBtn>
                <ProtoBtn
                  className="flex-[1.3]"
                  disabled={state.perspective !== 'arjun'}
                  onClick={() => {
                    pendingNav.current = `ride:${state.ride!.id}`;
                    dispatch({ type: 'acceptRequest' });
                  }}
                >
                  Accept request
                </ProtoBtn>
              </div>
              {state.perspective !== 'arjun' ? (
                <p className="mt-2 text-xs text-amber-800">Switch to Arjun to accept or decline.</p>
              ) : null}
            </ProtoCard>
          ) : null}

          <ProtoCard>
            <p className="text-sm font-semibold">Your active routes</p>
            <div className="mt-2 space-y-2">
              <div className="rounded-xl border border-border/70 px-3 py-2">
                <p className="text-sm font-semibold">Morning commute · {draft.leaveTime}</p>
                <p className="text-xs text-muted-foreground">
                  {draft.pickup} → {draft.dropoff}
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-800">
                  {hostOffer?.published
                    ? `${hostOffer.seatsOpen} of ${hostOffer.seatsTotal} seats open`
                    : 'Not published yet'}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 px-3 py-2 opacity-80">
                <p className="text-sm font-semibold">Evening return · 18:20</p>
                <p className="text-xs text-muted-foreground">
                  {draft.dropoff} → {draft.pickup}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Draft from schedule · Autopilot ready</p>
              </div>
            </div>
          </ProtoCard>

          <ProtoCard className="space-y-3">
            <div>
              <p className="font-semibold">Publish today’s offer</p>
              <p className="text-sm text-muted-foreground">Riders find you when their commute shares your corridor.</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field
                label="Pickup"
                value={draft.pickup}
                onChange={(v) => dispatch({ type: 'patchOfferDraft', patch: { pickup: v } })}
              />
              <Field
                label="Destination"
                value={draft.dropoff}
                onChange={(v) => dispatch({ type: 'patchOfferDraft', patch: { dropoff: v } })}
              />
              <Field
                label="Date"
                value={draft.date}
                onChange={(v) => dispatch({ type: 'patchOfferDraft', patch: { date: v } })}
              />
              <Field
                label="Departure"
                value={draft.leaveTime}
                onChange={(v) => dispatch({ type: 'patchOfferDraft', patch: { leaveTime: v } })}
              />
            </div>

            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Route stops
              </p>
              <AlongYourWay stops={draft.stops} />
              <div className="mt-2 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Add a pickup stop"
                  value={draft.stopInput}
                  onChange={(e) => dispatch({ type: 'patchOfferDraft', patch: { stopInput: e.target.value } })}
                />
                <ProtoBtn variant="secondary" onClick={() => dispatch({ type: 'addOfferStop' })}>
                  Add stop
                </ProtoBtn>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Match pins help discovery. Live drop order stays automatic.
              </p>
            </div>

            <Segmented
              value={draft.vehicleKind}
              options={[
                { id: 'two_wheeler', label: 'Two-wheeler' },
                { id: 'four_wheeler', label: 'Four-wheeler' },
              ]}
              onChange={(id) =>
                dispatch({ type: 'patchOfferDraft', patch: { vehicleKind: id as 'two_wheeler' | 'four_wheeler' } })
              }
            />

            <SeatStepper
              value={draft.seats}
              min={1}
              max={6}
              onChange={(n) => dispatch({ type: 'patchOfferDraft', patch: { seats: n } })}
              label="Available seats"
            />

            <div className="rounded-xl bg-emerald-50 px-3 py-2">
              <p className="text-sm font-semibold text-emerald-950">₹{draft.fuelGuide} - shared-cost guide</p>
              <p className="text-xs text-emerald-900/80">Neighborly commute contribution - not a commercial trip.</p>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Office days
              </p>
              <DayChips days={WEEK} selected={draft.days} onToggle={(d) => dispatch({ type: 'toggleOfferDay', day: d })} />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.flexible}
                onChange={(e) => dispatch({ type: 'patchOfferDraft', patch: { flexible: e.target.checked } })}
              />
              <span>My weekdays are flexible - show me nearby requests.</span>
            </label>

            <div className="rounded-xl border border-emerald-800/20 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
              Your phone number stays private until you accept a booking.
            </div>

            <MapPlane label="Route preview" meta={`${me.homeLabel} · usual road`} compact />

            <div className="flex gap-2">
              <ProtoBtn variant="ghost" className="flex-1" onClick={() => dispatch({ type: 'saveOfferDraft' })}>
                {draft.saved ? 'Draft saved' : 'Save for later'}
              </ProtoBtn>
              <ProtoBtn className="flex-[1.4]" onClick={() => dispatch({ type: 'publishOffer' })}>
                {hostOffer?.published ? 'Update & keep live' : 'Publish ride →'}
              </ProtoBtn>
            </div>
          </ProtoCard>

          <ProtoCard>
            <p className="text-sm font-semibold">Shared costs this month</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-900">₹1,240</p>
            <p className="text-xs text-muted-foreground">Mock fuel ledger preview - settle on completed rides.</p>
          </ProtoCard>
        </div>
      )}
    </ProtoPage>
  );
}
