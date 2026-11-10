// @ts-nocheck
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import {
  CleanerCityActiveMissionCard,
  CleanerCityActiveMissionDock,
} from '@/components/cleaner-city/CleanerCityActiveMissionCard';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useMyPublications, useMyRides } from '@/hooks/queries/useCleanerCity';
import { DEFAULT_COMMUTE_TIMEZONE } from '@/lib/cleaner-city/constants';
import { loadHomeSeatRequests } from '@/lib/cleaner-city/homeSeatRequests';
import { cn } from '@/lib/utils';

const LIVE = ['pickup_pending', 'started', 'safety_incident'];
const UPCOMING = ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'];

function todayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function CleanerCityRidesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: rides = [] } = useMyRides();
  const { data: publications = [] } = useMyPublications();
  const today = todayIso();
  const homeSeatRequests = useMemo(() => loadHomeSeatRequests(), []);

  const active =
    rides.find((r) => LIVE.includes(r.status) && r.travel_date === today) ||
    rides.find((r) => LIVE.includes(r.status));
  const upcoming = rides.filter((r) => UPCOMING.includes(r.status) && r.id !== active?.id);
  const completed = rides.filter((r) => r.status === 'completed').slice(0, 8);
  const livePubs = publications.filter((p) => ['published', 'full'].includes(p.status));
  const pendingDemo = homeSeatRequests.filter(
    (r) => r.status === 'requested' && !r.liveRideId,
  );

  return (
    <CleanerCityChrome headerTitle="Missions">
      <CleanerCityGate>
        <div className="mx-auto max-w-lg space-y-4 px-4 pb-6 pt-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-800/80">
              Missions
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your runs</h1>
            <p className="text-sm text-muted-foreground">
              Live quests, upcoming seats, and completed corridor trips.
            </p>
          </div>

          {active ? (
            <CleanerCityActiveMissionCard
              ride={active}
              myUserId={user?.id}
              todayIso={today}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center">
              <p className="text-sm font-semibold">No live quest</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Play to find a seat or offer empty seats on your corridor.
              </p>
              <div className="mt-3 flex gap-2">
                <Button className="flex-1 bg-emerald-800 hover:bg-emerald-900" asChild>
                  <Link to="/cleaner-city/find">Play · Find</Link>
                </Button>
                <Button variant="secondary" className="flex-1" asChild>
                  <Link to="/cleaner-city/offer">Play · Offer</Link>
                </Button>
              </div>
            </div>
          )}

          {pendingDemo.length > 0 ? (
            <section className="space-y-2" data-testid="cleaner-city-missions-seat-requests">
              <h2 className="text-sm font-semibold">Seat requests</h2>
              {pendingDemo.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm"
                >
                  <p className="text-sm font-semibold">{r.hostName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.pickupLabel} to {r.dropLabel} · {r.departTime}
                  </p>
                  <p className="mt-1 text-xs font-medium text-emerald-900">
                    Requested · ₹{r.fuelShareRs} shared cost · waiting on host
                  </p>
                  <Button
                    variant="link"
                    className="mt-1 h-auto px-0 text-emerald-900"
                    onClick={() => navigate('/cleaner-city')}
                  >
                    Back to Home matches
                  </Button>
                </div>
              ))}
            </section>
          ) : null}

          {upcoming.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Upcoming</h2>
              {upcoming.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left shadow-sm"
                  onClick={() => navigate(`/cleaner-city/ride/${r.id}`)}
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {r.travel_date} · {String(r.direction || '').replace('_', ' ')}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">{r.status.replace('_', ' ')}</p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-800">Open</span>
                </button>
              ))}
            </section>
          ) : null}

          {livePubs.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Your live offers</h2>
              {livePubs.slice(0, 4).map((p) => (
                <Link
                  key={p.id}
                  to="/cleaner-city/offer"
                  state={{ focusPublicationId: p.id, tab: 'rides' }}
                  className="block rounded-2xl border border-border bg-card p-4 shadow-sm"
                >
                  <p className="text-sm font-semibold">
                    {p.travel_date} · {String(p.direction || '').replace('_', ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.seats_available ?? p.seats_total} seats · {p.status}
                  </p>
                </Link>
              ))}
            </section>
          ) : null}

          {completed.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Completed</h2>
              {completed.map((r) => (
                <div
                  key={r.id}
                  className={cn('rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm')}
                >
                  <p className="font-medium">
                    {r.travel_date} · {user?.id === r.host_user_id ? 'Hosted' : 'Rode'}
                  </p>
                  <p className="text-xs text-muted-foreground">Completed · rate & fuel in ride history</p>
                </div>
              ))}
            </section>
          ) : null}
        </div>
        {active ? <CleanerCityActiveMissionDock ride={active} myUserId={user?.id} /> : null}
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
