import { Link, useNavigate } from 'react-router-dom';
import { Building2, ShieldCheck } from 'lucide-react';
import { useProto } from '../store';
import {
  AlongYourWay,
  Field,
  InitialsAvatar,
  MapPlane,
  ProtoBtn,
  ProtoCard,
  ProtoHero,
  ProtoPage,
  StatusPill,
  TrustChip,
  VerticalRoute,
} from '../ui';

export function HomeScreen() {
  const { state, dispatch, me } = useProto();
  const navigate = useNavigate();
  const ride = state.ride;
  const live = ride && ['requested', 'confirmed', 'pickup_pending', 'started'].includes(ride.status);
  const topMatch = state.findMatches.find((o) => o.bestFit) || state.findMatches[0];
  const search = state.findSearch;

  return (
    <ProtoPage>
      <ProtoHero
        title={`Good morning, ${me.name.split(' ')[0]}`}
        subtitle="Where are you headed?"
      >
        <p className="text-sm text-emerald-50/90">
          {me.homeLabel} → {me.officeLabel}
        </p>
      </ProtoHero>

      <div className="flex flex-wrap gap-2">
        <ProtoBtn
          variant="secondary"
          className="flex-1 gap-1.5 shadow-sm"
          onClick={() => dispatch({ type: 'setSheet', sheet: 'verify-email' })}
        >
          <Building2 className="h-4 w-4" />
          Verify office email
        </ProtoBtn>
        <ProtoBtn
          className="flex-1"
          onClick={() => {
            dispatch({ type: 'setMode', mode: 'offer' });
            navigate('/cleaner-city/prototype/discover');
          }}
        >
          + Offer a ride
        </ProtoBtn>
      </div>

      {me.verified ? (
        <ProtoCard className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-900">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Your profile is verified</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Drivers can see your trusted member badge when you request a seat.
            </p>
            <Link
              to="/cleaner-city/prototype/profile"
              className="mt-1.5 inline-block text-xs font-semibold text-emerald-800"
            >
              View your profile &gt;
            </Link>
          </div>
        </ProtoCard>
      ) : (
        <ProtoCard onClick={() => dispatch({ type: 'setSheet', sheet: 'verify-email' })}>
          <p className="text-sm font-semibold">Verify your work email</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Trusted everyday commutes with neighbours at your workplace.
          </p>
        </ProtoCard>
      )}

      {live && ride ? (
        <ProtoCard onClick={() => navigate(`/cleaner-city/prototype/ride/${ride.id}`)}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Active commute</p>
            <StatusPill tone="live">{ride.status.replace('_', ' ')}</StatusPill>
          </div>
          <p className="text-sm text-muted-foreground">
            Today · 08:35 · {ride.meetingPoint || 'Meeting point pending'}
          </p>
          <p className="mt-2 text-sm font-medium text-emerald-800">Continue ride mission →</p>
        </ProtoCard>
      ) : (
        <ProtoCard className="space-y-3">
          <p className="text-sm font-semibold">Quick search</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Pickup" value={search.pickup} readOnly />
            <Field label="Drop-off" value={search.dropoff} readOnly />
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-secondary px-2.5 py-1 font-medium">{search.date}</span>
            <span className="rounded-full bg-secondary px-2.5 py-1 font-medium">{search.leaveTime}</span>
            <span className="rounded-full bg-secondary px-2.5 py-1 font-medium">
              {search.seatsNeeded} seat{search.seatsNeeded === 1 ? '' : 's'}
            </span>
          </div>
          <ProtoBtn
            className="w-full"
            onClick={() => {
              dispatch({ type: 'setMode', mode: 'find' });
              dispatch({ type: 'runFindSearch' });
              navigate('/cleaner-city/prototype/discover');
            }}
          >
            Search rides
          </ProtoBtn>
        </ProtoCard>
      )}

      <MapPlane
        label="Your corridor"
        meta="Greenfield Tower H · Outer Ring Rd · Manyata"
        compact
      />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Nearby matches</h2>
          <Link
            to="/cleaner-city/prototype/discover"
            className="text-xs font-semibold text-emerald-800"
            onClick={() => dispatch({ type: 'setMode', mode: 'find' })}
          >
            See all
          </Link>
        </div>
        {topMatch ? (
          <ProtoCard
            className="space-y-3"
            onClick={() => {
              dispatch({ type: 'setMode', mode: 'find' });
              navigate('/cleaner-city/prototype/discover');
            }}
          >
            {topMatch.bestFit ? (
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                <span className="inline-block h-1.5 w-1.5 rounded-sm bg-emerald-700" aria-hidden />
                Best route overlap for you
              </p>
            ) : null}
            <div className="flex items-start gap-3">
              <InitialsAvatar name={topMatch.hostName} />
              <div className="min-w-0">
                <p className="font-semibold">{topMatch.hostName}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {topMatch.communityVerified ? <TrustChip>Community profile</TrustChip> : null}
                  {topMatch.officeVerified ? <TrustChip tone="muted">Office email</TrustChip> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {topMatch.rating} rating · {topMatch.ridesDone} shared rides · {topMatch.vehicleLabel}
                </p>
              </div>
            </div>
            <VerticalRoute
              from={search.pickup}
              to={search.dropoff}
              leaveTime={topMatch.time}
              arriveTime={topMatch.arriveTime}
              durationMin={topMatch.durationMin}
            />
            <AlongYourWay stops={topMatch.stops} />
            <p className="text-sm font-semibold">
              ₹{topMatch.fuelEstimate}{' '}
              <span className="text-xs font-normal text-muted-foreground">shared cost / seat</span>
            </p>
          </ProtoCard>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">This week</h2>
        <div className="grid grid-cols-5 gap-1.5">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
            <div key={d} className="rounded-xl border border-border/70 bg-card py-2 text-center">
              <p className="text-[10px] text-muted-foreground">{d}</p>
              <p className="text-xs font-semibold">{me.leaveTime}</p>
            </div>
          ))}
        </div>
      </section>

      <ProtoCard>
        <p className="text-sm font-semibold">Suggestion</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.perspective === 'priya'
            ? 'Two hosts leave within 10 minutes of you on the Manyata corridor.'
            : 'Autopilot can draft tomorrow’s offer from your schedule (confirm before live).'}
        </p>
      </ProtoCard>

      <p className="text-center text-[11px] text-muted-foreground">
        Soft impact preview · sharing this corridor keeps one more car off ORR.
      </p>
    </ProtoPage>
  );
}
